/**
 * Assinatura da clínica no Asaas — o dinheiro que a CLINNI recebe.
 *
 * Orquestra: cliente no Asaas → assinatura recorrente → espelho das faturas.
 * Toda escrita aqui pressupõe service client atrás de `requireSuperAdmin`
 * (é operação de plataforma, não de tenant).
 *
 * As tabelas da 0212 ainda não estão nos tipos gerados; daí o `as never` no
 * nome — mesmo padrão de `admin/plan-prices.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { logger } from '@/lib/observability/logger'
import { getPlanPrices } from '@/lib/core/admin/plan-prices'
import type { Plan } from '@/lib/core/entitlements/plans'
import {
  cancelSubscription,
  createCustomer,
  createSubscription,
  findCustomerByExternalRef,
  isAsaasConfigured,
  listSubscriptionPayments,
  updateCustomer,
  updateSubscription,
} from './asaas/client'
import type { AsaasBillingType, AsaasCycle } from './asaas/types'
import { upsertChargeFromAsaas } from './charges'
import { buildSplit, getPartner, resolveSplitRule, type BillingPartner } from './partners'

export interface TenantBilling {
  tenantId: string
  asaasCustomerId: string | null
  asaasSubscriptionId: string | null
  billingCycle: AsaasCycle
  billingType: AsaasBillingType
  /** `null` = usa o preço de tabela do plano. */
  priceCents: number | null
  nextDueDate: string | null
  partnerId: string | null
  /** Repasse desta clínica ao parceiro. NULL nos dois = usa o padrão do parceiro. */
  splitPercentBps: number | null
  splitFixedCents: number | null
  notes: string | null
}

interface BillingRow {
  tenant_id: string
  asaas_customer_id: string | null
  asaas_subscription_id: string | null
  billing_cycle: string
  billing_type: string
  price_cents: number | null
  next_due_date: string | null
  partner_id: string | null
  split_percent_bps: number | null
  split_fixed_cents: number | null
  notes: string | null
}

const COLUMNS =
  'tenant_id, asaas_customer_id, asaas_subscription_id, billing_cycle, billing_type, price_cents, next_due_date, partner_id, split_percent_bps, split_fixed_cents, notes'

function mapRow(r: BillingRow): TenantBilling {
  return {
    tenantId: r.tenant_id,
    asaasCustomerId: r.asaas_customer_id,
    asaasSubscriptionId: r.asaas_subscription_id,
    billingCycle: r.billing_cycle as AsaasCycle,
    billingType: r.billing_type as AsaasBillingType,
    priceCents: r.price_cents,
    nextDueDate: r.next_due_date,
    partnerId: r.partner_id,
    splitPercentBps: r.split_percent_bps,
    splitFixedCents: r.split_fixed_cents,
    notes: r.notes,
  }
}

export async function getTenantBilling(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<TenantBilling | null> {
  const { data, error } = await supabase
    .from('tenant_billing' as never)
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`getTenantBilling failed: ${error.message}`)
  return data ? mapRow(data as unknown as BillingRow) : null
}

export interface SaveTenantBillingInput {
  billingCycle?: AsaasCycle
  billingType?: AsaasBillingType
  priceCents?: number | null
  nextDueDate?: string | null
  partnerId?: string | null
  /** Repasse ao parceiro. `null` nos dois volta ao padrão do parceiro. */
  splitPercentBps?: number | null
  splitFixedCents?: number | null
  notes?: string | null
}

/**
 * Salva a configuração local de cobrança da clínica. NÃO fala com o Asaas —
 * quem propaga é `startOrUpdateSubscription`. Separar as duas coisas é o que
 * permite configurar antes de existir conta lá, e o que impede que salvar uma
 * anotação dispare chamada externa.
 */
export async function saveTenantBilling(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: SaveTenantBillingInput,
): Promise<TenantBilling> {
  if (input.priceCents !== undefined && input.priceCents !== null) {
    if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
      throw new ValidationError('Preço inválido (centavos inteiros ≥ 0).')
    }
  }
  if (input.nextDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.nextDueDate)) {
    throw new ValidationError('Data de vencimento deve ser AAAA-MM-DD.')
  }
  // O banco já barra os dois modos juntos; barrar aqui devolve mensagem em
  // português em vez de erro de constraint na cara de quem está configurando.
  if (
    input.splitPercentBps !== undefined &&
    input.splitPercentBps !== null &&
    input.splitFixedCents !== undefined &&
    input.splitFixedCents !== null
  ) {
    throw new ValidationError('Escolha percentual OU valor fixo no repasse, não os dois.')
  }

  const row: Record<string, unknown> = { tenant_id: tenantId }
  if (input.billingCycle !== undefined) row.billing_cycle = input.billingCycle
  if (input.billingType !== undefined) row.billing_type = input.billingType
  if (input.priceCents !== undefined) row.price_cents = input.priceCents
  if (input.nextDueDate !== undefined) row.next_due_date = input.nextDueDate
  if (input.partnerId !== undefined) row.partner_id = input.partnerId
  if (input.splitPercentBps !== undefined) row.split_percent_bps = input.splitPercentBps
  if (input.splitFixedCents !== undefined) row.split_fixed_cents = input.splitFixedCents
  if (input.notes !== undefined) row.notes = input.notes

  const { error } = await supabase
    .from('tenant_billing' as never)
    .upsert(row as never, { onConflict: 'tenant_id' })
  if (error) throw new Error(`saveTenantBilling failed: ${error.message}`)

  const saved = await getTenantBilling(supabase, tenantId)
  if (!saved) throw new Error('saveTenantBilling: linha não encontrada após upsert')
  return saved
}

/**
 * Quanto esta clínica paga por ciclo, em centavos.
 *
 * Override negociado vence o preço de tabela. Zero é um valor VÁLIDO (cortesia,
 * clínica-piloto) e por isso o teste é `!== null`, não `||` — com `||` uma
 * cortesia de R$ 0,00 cairia de volta no preço cheio.
 */
export async function effectivePriceCents(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<number> {
  const [billing, prices, ent] = await Promise.all([
    getTenantBilling(supabase, tenantId),
    getPlanPrices(supabase),
    supabase.from('tenant_entitlements').select('plan').eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (billing?.priceCents !== null && billing?.priceCents !== undefined) return billing.priceCents
  const plan = ((ent.data as { plan?: string } | null)?.plan ?? 'legacy') as Plan
  return prices[plan] ?? 0
}

// =========================================================================
// Cliente no Asaas
// =========================================================================

interface TenantIdentity {
  name: string
  cnpj: string | null
  email: string | null
  phone: string | null
}

async function loadTenantIdentity(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<TenantIdentity> {
  const [tenant, profile] = await Promise.all([
    supabase.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    supabase
      .from('tenant_clinic_profile')
      .select('corporate_name, cnpj, email, phone')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  if (!tenant.data) throw new NotFoundError('tenant', tenantId)
  const p = profile.data as {
    corporate_name?: string | null
    cnpj?: string | null
    email?: string | null
    phone?: string | null
  } | null
  return {
    // Razão social manda no nome fiscal; o nome de fantasia só entra se não
    // houver razão social cadastrada. É a razão social que sai na nota.
    name: p?.corporate_name?.trim() || (tenant.data as { name: string }).name,
    cnpj: p?.cnpj ?? null,
    email: p?.email ?? null,
    phone: p?.phone ?? null,
  }
}

/**
 * Garante que a clínica existe como cliente no Asaas e devolve o id de lá.
 *
 * Idempotente por `externalReference = tenants.id`: rechamar não cria segundo
 * cliente. Se já houver id gravado, ATUALIZA os dados cadastrais em vez de
 * criar — assim corrigir o CNPJ no perfil da clínica alcança o Asaas.
 */
export async function ensureAsaasCustomer(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<string> {
  if (!isAsaasConfigured()) throw new ValidationError('Asaas não configurado (ASAAS_API_KEY).')

  const identity = await loadTenantIdentity(supabase, tenantId)
  if (!identity.cnpj) {
    // Sem documento o Asaas recusa a criação. Falhar aqui, com esta mensagem,
    // é melhor que devolver o erro cru do gateway — quem lê no /admin precisa
    // saber que o conserto é no cadastro da clínica.
    throw new ValidationError(
      'A clínica precisa ter CNPJ preenchido em Configurações → Clínica antes de virar cliente no Asaas.',
    )
  }

  const existing = await getTenantBilling(supabase, tenantId)
  if (existing?.asaasCustomerId) {
    await updateCustomer(existing.asaasCustomerId, {
      name: identity.name,
      cpfCnpj: identity.cnpj,
      email: identity.email,
      mobilePhone: identity.phone,
    })
    return existing.asaasCustomerId
  }

  // Pode existir lá sem estar gravado aqui (criação que falhou depois do POST).
  // Buscar antes de criar é o que impede cliente duplicado no Asaas.
  const found = await findCustomerByExternalRef(tenantId)
  const customer =
    found ??
    (await createCustomer({
      externalReference: tenantId,
      name: identity.name,
      cpfCnpj: identity.cnpj,
      email: identity.email,
      mobilePhone: identity.phone,
    }))

  await saveCustomerId(supabase, tenantId, customer.id)
  return customer.id
}

async function saveCustomerId(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const { error } = await supabase
    .from('tenant_billing' as never)
    .upsert({ tenant_id: tenantId, asaas_customer_id: customerId } as never, {
      onConflict: 'tenant_id',
    })
  if (error) throw new Error(`saveCustomerId failed: ${error.message}`)
}

// =========================================================================
// Assinatura
// =========================================================================

export interface StartSubscriptionResult {
  subscriptionId: string
  amountCents: number
  splitCents: number | null
  charges: number
}

/**
 * Cria a assinatura da clínica, ou atualiza a existente com o preço/ciclo/split
 * vigentes. Idempotente: rechamar com a mesma configuração não gera segunda
 * assinatura nem segunda cobrança.
 *
 * `updatePendingPayments` fica FALSO por padrão. Mudar de plano no meio do mês
 * não deveria reescrever, sozinho, uma fatura que já foi enviada ao cliente e
 * pode estar aberta no aplicativo do banco dele; o novo valor vale do próximo
 * ciclo. Quem quiser reemitir pede explicitamente.
 */
export async function startOrUpdateSubscription(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: { updatePendingPayments?: boolean } = {},
): Promise<StartSubscriptionResult> {
  const customerId = await ensureAsaasCustomer(supabase, tenantId)
  const billing = await getTenantBilling(supabase, tenantId)
  const amountCents = await effectivePriceCents(supabase, tenantId)

  if (amountCents <= 0) {
    throw new ValidationError(
      'Preço da assinatura é zero. Defina o preço do plano ou um valor negociado antes de cobrar.',
    )
  }

  const partner: BillingPartner | null = billing?.partnerId
    ? await getPartner(supabase, billing.partnerId)
    : null
  // A regra da CLÍNICA manda; a do parceiro é só o padrão (0216 D1).
  const rule = resolveSplitRule(partner, {
    percentBps: billing?.splitPercentBps ?? null,
    fixedCents: billing?.splitFixedCents ?? null,
  })
  const split = buildSplit(partner, rule, amountCents)

  const cycle = billing?.billingCycle ?? 'MONTHLY'
  const billingType = billing?.billingType ?? 'UNDEFINED'
  const nextDueDate = billing?.nextDueDate ?? defaultFirstDueDate()
  const identity = await loadTenantIdentity(supabase, tenantId)
  const description = `Assinatura Clinni — ${identity.name}`

  let subscriptionId = billing?.asaasSubscriptionId ?? null

  if (subscriptionId) {
    await updateSubscription(subscriptionId, {
      amountCents,
      cycle,
      billingType,
      description,
      split: split?.split ?? [],
      updatePendingPayments: opts.updatePendingPayments ?? false,
    })
  } else {
    const created = await createSubscription({
      customerId,
      amountCents,
      cycle,
      billingType,
      nextDueDate,
      description,
      externalReference: tenantId,
      split: split?.split,
    })
    subscriptionId = created.id
    const { error } = await supabase.from('tenant_billing' as never).upsert(
      {
        tenant_id: tenantId,
        asaas_subscription_id: subscriptionId,
        next_due_date: created.nextDueDate ?? nextDueDate,
      } as never,
      { onConflict: 'tenant_id' },
    )
    if (error) throw new Error(`persist subscription failed: ${error.message}`)
  }

  logger.info(
    {
      event: 'billing.subscription_saved',
      tenant_id: tenantId,
      subscription_id: subscriptionId,
      amount_cents: amountCents,
      split_cents: split?.amountCents ?? null,
      partner: partner?.slug ?? null,
    },
    'billing-subscription-saved',
  )

  // Puxa as faturas já geradas para a tela não ficar vazia até o primeiro
  // webhook chegar.
  const charges = await syncSubscriptionCharges(supabase, tenantId, {
    partnerId: partner?.id ?? null,
    splitAmountCents: split?.amountCents ?? null,
  })

  return {
    subscriptionId,
    amountCents,
    splitCents: split?.amountCents ?? null,
    charges,
  }
}

/**
 * Reconciliação: relê as faturas da assinatura no Asaas e reescreve o espelho.
 *
 * É a rede de segurança do webhook — webhook perdido, deploy no ar na hora da
 * entrega, evento que falhou no processamento. Como o espelho é UPSERT por
 * `asaas_payment_id`, rodar isto duas vezes não duplica nada.
 */
export async function syncSubscriptionCharges(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  snapshot?: { partnerId: string | null; splitAmountCents: number | null },
): Promise<number> {
  const billing = await getTenantBilling(supabase, tenantId)
  if (!billing?.asaasSubscriptionId) return 0

  const payments = await listSubscriptionPayments(billing.asaasSubscriptionId)
  for (const p of payments) {
    // O snapshot só é aplicado a fatura NOVA. Reescrever o split de uma fatura
    // antiga com a regra de hoje apagaria o histórico do que foi dividido (D3).
    const known = snapshot ? await chargeExists(supabase, p.id) : true
    await upsertChargeFromAsaas(supabase, tenantId, p, known ? undefined : snapshot)
  }
  return payments.length
}

async function chargeExists(
  supabase: SupabaseClient<Database>,
  asaasPaymentId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('billing_charges' as never)
    .select('id')
    .eq('asaas_payment_id', asaasPaymentId)
    .maybeSingle()
  return Boolean(data)
}

/**
 * Cancela a assinatura no Asaas e limpa o id local.
 *
 * O histórico de `billing_charges` NÃO é apagado: o que foi cobrado aconteceu,
 * e o extrato da clínica conosco não some porque o contrato acabou.
 */
export async function cancelTenantSubscription(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<void> {
  const billing = await getTenantBilling(supabase, tenantId)
  if (!billing?.asaasSubscriptionId) {
    throw new ConflictError('NO_SUBSCRIPTION', 'Esta clínica não tem assinatura ativa no Asaas.')
  }
  await cancelSubscription(billing.asaasSubscriptionId)
  const { error } = await supabase
    .from('tenant_billing' as never)
    .update({ asaas_subscription_id: null, next_due_date: null } as never)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`cancelTenantSubscription failed: ${error.message}`)

  logger.info(
    { event: 'billing.subscription_canceled', tenant_id: tenantId },
    'billing-subscription-canceled',
  )
}

/**
 * Primeiro vencimento padrão: 7 dias à frente.
 *
 * Não é "hoje": cobrança que vence no dia da criação já nasce vencendo, e o
 * cliente recebe o aviso do Asaas junto com a régua de inadimplência. Sete dias
 * dão folga para o boleto compensar e para a clínica reagir.
 */
function defaultFirstDueDate(): string {
  const d = new Date(Date.now() + 7 * 86400000)
  return d.toISOString().slice(0, 10)
}
