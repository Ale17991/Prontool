/**
 * Parceiros comerciais que recebem split da assinatura (ex.: zee.lu).
 *
 * Tabela de PLATAFORMA: sem `tenant_id`, escrita só por service client atrás
 * de `requireSuperAdmin`. As tabelas da 0212 ainda não estão nos tipos gerados
 * (só depois de `pnpm supabase:gen-types`), daí o cast `as never` no nome —
 * mesmo padrão de `admin/plan-prices.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError, NotFoundError } from '@/lib/observability/errors'
import { logger } from '@/lib/observability/logger'
import { splitAmountCents } from './asaas/money'
import type { AsaasSplit } from './asaas/types'

export interface BillingPartner {
  id: string
  name: string
  slug: string
  asaasWalletId: string | null
  splitPercentBps: number | null
  splitFixedCents: number | null
  status: 'active' | 'inactive'
  notes: string | null
}

interface PartnerRow {
  id: string
  name: string
  slug: string
  asaas_wallet_id: string | null
  split_percent_bps: number | null
  split_fixed_cents: number | null
  status: string
  notes: string | null
}

const COLUMNS =
  'id, name, slug, asaas_wallet_id, split_percent_bps, split_fixed_cents, status, notes'

function mapRow(r: PartnerRow): BillingPartner {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    asaasWalletId: r.asaas_wallet_id,
    splitPercentBps: r.split_percent_bps,
    splitFixedCents: r.split_fixed_cents,
    status: r.status === 'inactive' ? 'inactive' : 'active',
    notes: r.notes,
  }
}

export async function listPartners(supabase: SupabaseClient<Database>): Promise<BillingPartner[]> {
  const { data, error } = await supabase
    .from('billing_partners' as never)
    .select(COLUMNS)
    .order('name')
  if (error) throw new Error(`listPartners failed: ${error.message}`)
  return ((data ?? []) as unknown as PartnerRow[]).map(mapRow)
}

export async function getPartner(
  supabase: SupabaseClient<Database>,
  partnerId: string,
): Promise<BillingPartner | null> {
  const { data, error } = await supabase
    .from('billing_partners' as never)
    .select(COLUMNS)
    .eq('id', partnerId)
    .maybeSingle()
  if (error) throw new Error(`getPartner failed: ${error.message}`)
  return data ? mapRow(data as unknown as PartnerRow) : null
}

export async function getPartnerBySlug(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<BillingPartner | null> {
  const { data, error } = await supabase
    .from('billing_partners' as never)
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`getPartnerBySlug failed: ${error.message}`)
  return data ? mapRow(data as unknown as PartnerRow) : null
}

export interface UpsertPartnerInput {
  id?: string
  name: string
  slug: string
  asaasWalletId: string | null
  /** Pontos-base (2500 = 25%). Exclusivo com `splitFixedCents`. */
  splitPercentBps: number | null
  splitFixedCents: number | null
  status?: 'active' | 'inactive'
  notes?: string | null
}

export async function upsertPartner(
  supabase: SupabaseClient<Database>,
  actorId: string,
  input: UpsertPartnerInput,
): Promise<string> {
  if (!input.name.trim()) throw new ValidationError('Nome do parceiro é obrigatório.')
  if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(input.slug)) {
    throw new ValidationError('Identificador inválido (minúsculas, números, - e _).')
  }
  // O banco já barra os dois modos juntos; barrar aqui devolve mensagem em
  // português em vez de erro de constraint na cara de quem está cadastrando.
  if (input.splitPercentBps !== null && input.splitFixedCents !== null) {
    throw new ValidationError('Escolha percentual OU valor fixo, não os dois.')
  }
  if (
    input.splitPercentBps !== null &&
    (input.splitPercentBps <= 0 || input.splitPercentBps > 10000)
  ) {
    throw new ValidationError('Percentual deve ficar entre 0,01% e 100%.')
  }
  if (input.splitFixedCents !== null && input.splitFixedCents <= 0) {
    throw new ValidationError('Valor fixo deve ser maior que zero.')
  }

  const row = {
    ...(input.id ? { id: input.id } : {}),
    name: input.name.trim(),
    slug: input.slug,
    asaas_wallet_id: input.asaasWalletId?.trim() || null,
    split_percent_bps: input.splitPercentBps,
    split_fixed_cents: input.splitFixedCents,
    status: input.status ?? 'active',
    notes: input.notes ?? null,
  }

  const { data, error } = await supabase
    .from('billing_partners' as never)
    .upsert(row as never, { onConflict: 'slug' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`upsertPartner failed: ${error?.message}`)

  // `audit_log` é tenant-scoped e não se aplica a config global (mesma razão
  // de `setPlanPrice` logar no logger de plataforma).
  logger.info(
    {
      event: 'billing_partner.saved',
      actor_id: actorId,
      slug: input.slug,
      split_percent_bps: input.splitPercentBps,
      split_fixed_cents: input.splitFixedCents,
    },
    'billing-partner-saved',
  )
  return (data as unknown as { id: string }).id
}

/** Regra de repasse já resolvida — de quem recebe e quanto. */
export interface SplitRule {
  walletId: string | null
  percentBps: number | null
  fixedCents: number | null
}

/**
 * Regra que VALE para esta clínica (0216 D1).
 *
 * A da clínica manda; a do parceiro é só o padrão, usado quando a clínica não
 * tem a própria. Mesmo desenho de `tenant_billing.price_cents`, que é NULL
 * quando se usa o preço de tabela do plano.
 *
 * A escolha é por MODO, não campo a campo: uma clínica que define percentual
 * não herda o valor fixo do parceiro. Misturar os dois produziria uma regra que
 * ninguém escreveu.
 */
export function resolveSplitRule(
  partner: BillingPartner | null,
  clinica: { percentBps: number | null; fixedCents: number | null },
): SplitRule {
  if (!partner) return { walletId: null, percentBps: null, fixedCents: null }
  const temPropria = clinica.percentBps !== null || clinica.fixedCents !== null
  return {
    walletId: partner.asaasWalletId,
    percentBps: temPropria ? clinica.percentBps : partner.splitPercentBps,
    fixedCents: temPropria ? clinica.fixedCents : partner.splitFixedCents,
  }
}

/**
 * Monta o objeto de split do Asaas para uma cobrança de `amountCents`.
 *
 * Devolve `null` — e não um array vazio — quando não há split a fazer, porque
 * quem chama precisa distinguir "não divide" de "divide zero" ao decidir se
 * manda o campo na requisição.
 *
 * Parceiro INATIVO ou SEM CARTEIRA não divide, e isso é falha silenciosa por
 * escolha: recusar a cobrança inteira porque o parceiro não terminou de abrir
 * a conta deixaria a Clinni sem receber. Fica o aviso no log; o acerto com o
 * parceiro é conversa comercial, não bloqueio de faturamento.
 *
 * Sem regra também não divide (0216 D2). É a direção segura: o dinheiro fica
 * conosco e se resolve conversando. Dividir por engano manda dinheiro para
 * fora, e isso não volta.
 */
export function buildSplit(
  partner: BillingPartner | null,
  rule: SplitRule,
  amountCents: number,
): { split: AsaasSplit[]; amountCents: number } | null {
  if (!partner) return null
  if (partner.status !== 'active') return null
  if (!rule.walletId) {
    logger.warn(
      { event: 'billing_partner.no_wallet', slug: partner.slug },
      'partner-without-wallet-skipping-split',
    )
    return null
  }
  const cents = splitAmountCents(amountCents, {
    splitPercentBps: rule.percentBps,
    splitFixedCents: rule.fixedCents,
  })
  if (cents === null || cents <= 0) return null

  // Mandamos SEMPRE `fixedValue`, mesmo quando a regra é percentual: o valor em
  // centavos já foi calculado e arredondado aqui, e é ele que gravamos como
  // snapshot. Deixar o Asaas recalcular o percentual criaria duas verdades
  // sobre a mesma divisão, com arredondamentos que não têm por que coincidir.
  return {
    split: [{ walletId: rule.walletId, fixedValue: cents / 100 }],
    amountCents: cents,
  }
}

/** Resolve o parceiro de uma clínica (via `tenant_billing.partner_id`). */
export async function partnerForTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<BillingPartner | null> {
  const { data, error } = await supabase
    .from('tenant_billing' as never)
    .select('partner_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`partnerForTenant failed: ${error.message}`)
  const partnerId = (data as unknown as { partner_id: string | null } | null)?.partner_id
  if (!partnerId) return null
  const partner = await getPartner(supabase, partnerId)
  if (!partner) throw new NotFoundError('billing_partner', partnerId)
  return partner
}
