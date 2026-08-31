/**
 * O que um parceiro enxerga da nossa base.
 *
 * Três perguntas, que são exatamente as que a zee.lu faz: quais clínicas usam o
 * serviço dela, quais os dados para abrir a conta lá, e quais os dados para
 * emitir a nota.
 *
 * O RECORTE é sempre `tenant_billing.partner_id = <parceiro>`. Esse vínculo é o
 * que significa "esta clínica usa o serviço deste parceiro" — é ele que o
 * /admin marca e é dele que sai o split. Nenhuma função daqui aceita
 * `partnerId` vindo do cliente: quem chama recebeu o parceiro do guard, que o
 * tirou da chave.
 *
 * LIMITE CONHECIDO: a relação é de UM parceiro por clínica. Se um dia uma
 * clínica usar dois parceiros, isto vira tabela de junção — e o recorte não
 * muda de forma, só de origem.
 *
 * NUNCA há junção com `patients` NESTE arquivo: aqui o assunto é a clínica.
 * A identificação de paciente existe em `financeiro.ts`, e só porque a nota
 * fiscal exige um tomador — lá saem nome e CPF, e nada mais.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { splitAmountCents } from '@/lib/core/billing/asaas/money'
import { varrerTudo } from './scan'
import { MAX_POR_PAGINA, type Paginacao } from './financeiro'

// =========================================================================
// 1. Quais clínicas usam o serviço do parceiro
// =========================================================================

export interface PartnerClinicSummary {
  id: string
  nome: string
  slug: string
  /** 'ativa' | 'suspensa' — situação da conta no nosso produto. */
  situacao: 'ativa' | 'suspensa'
  plano: string
  /** 'trial' | 'active' | 'past_due' | 'canceled' — situação da assinatura. */
  situacao_assinatura: string
  /** Desde quando está vinculada a este parceiro (AAAA-MM-DD). */
  vinculada_em: string | null
}

export async function listPartnerClinics(
  supabase: SupabaseClient<Database>,
  partnerId: string,
): Promise<PartnerClinicSummary[]> {
  // Varredura em lotes: o PostgREST corta em 1.000 linhas sem avisar, e um
  // parceiro com mais de mil clínicas veria a lista terminar em silêncio.
  const links = await varrerTudo<{ tenant_id: string; created_at: string }>(
    (de, ate) =>
      supabase
        .from('tenant_billing' as never)
        .select('tenant_id, created_at')
        .eq('partner_id', partnerId)
        .order('tenant_id')
        .range(de, ate),
    'listPartnerClinics',
  )
  if (links.length === 0) return []
  const ids = links.map((l) => l.tenant_id)
  const linkedAt = new Map(links.map((l) => [l.tenant_id, l.created_at]))

  const [tenants, ents] = await Promise.all([
    supabase.from('tenants').select('id, name, slug, status').in('id', ids),
    supabase.from('tenant_entitlements').select('tenant_id, plan, status').in('tenant_id', ids),
  ])

  const entById = new Map(
    (
      (ents.data ?? []) as unknown as Array<{
        tenant_id: string
        plan: string
        status: string | null
      }>
    ).map((e) => [e.tenant_id, e]),
  )

  return (
    (tenants.data ?? []) as unknown as Array<{
      id: string
      name: string
      slug: string
      status: string
    }>
  )
    .map((t) => ({
      id: t.id,
      nome: t.name,
      slug: t.slug,
      situacao: (t.status === 'suspended' ? 'suspensa' : 'ativa') as 'ativa' | 'suspensa',
      plano: entById.get(t.id)?.plan ?? 'legacy',
      situacao_assinatura: entById.get(t.id)?.status ?? 'active',
      vinculada_em: linkedAt.get(t.id)?.slice(0, 10) ?? null,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/**
 * Esta clínica é deste parceiro?
 *
 * Verificação barata, feita ANTES de qualquer leitura nas rotas financeiras.
 * Existe separada de `getPartnerClinic` porque aquela carrega o cadastro
 * inteiro — e checar posse não deve custar a leitura do que talvez não possa
 * ser lido.
 */
export async function partnerOwnsClinic(
  supabase: SupabaseClient<Database>,
  partnerId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('tenant_billing' as never)
    .select('tenant_id')
    .eq('partner_id', partnerId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return Boolean(data)
}

// =========================================================================
// 2. Cadastro para abrir a conta no parceiro
// =========================================================================

export interface PartnerClinicDetail extends PartnerClinicSummary {
  razao_social: string | null
  cnpj: string | null
  email: string | null
  telefone: string | null
  endereco: {
    cep: string | null
    logradouro: string | null
    numero: string | null
    complemento: string | null
    bairro: string | null
    cidade: string | null
    uf: string | null
  }
  responsavel_tecnico: {
    nome: string | null
    conselho: string | null
    registro: string | null
  }
  /**
   * Pessoa de contato — o administrador da clínica. É o único dado de PESSOA
   * FÍSICA que esta API entrega, e existe porque abrir conta em serviço de
   * terceiro exige um titular. Nome e e-mail, nada mais: sem telefone pessoal,
   * sem id de usuário, sem os demais membros da equipe.
   */
  contato: { nome: string | null; email: string | null } | null
}

export async function getPartnerClinic(
  supabase: SupabaseClient<Database>,
  partnerId: string,
  tenantId: string,
): Promise<PartnerClinicDetail | null> {
  // O vínculo é verificado ANTES de qualquer leitura de cadastro. Consultar
  // primeiro e filtrar depois já teria lido dado de clínica que não é deste
  // parceiro — e um erro de fluxo adiante vazaria o que nunca deveria ter sido
  // carregado.
  const { data: link } = await supabase
    .from('tenant_billing' as never)
    .select('tenant_id, created_at')
    .eq('partner_id', partnerId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!link) return null

  const [tenant, profile, ent, admin] = await Promise.all([
    supabase.from('tenants').select('id, name, slug, status').eq('id', tenantId).maybeSingle(),
    supabase
      .from('tenant_clinic_profile')
      .select(
        'corporate_name, cnpj, email, phone, address_cep, address_street, address_number, address_complement, address_neighborhood, address_city, address_uf, tech_responsible_name, tech_responsible_council, tech_responsible_registration',
      )
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('tenant_entitlements')
      .select('plan, status')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    findClinicAdmin(supabase, tenantId),
  ])

  const t = tenant.data as { id: string; name: string; slug: string; status: string } | null
  if (!t) return null
  const p = (profile.data ?? {}) as Record<string, string | null>
  const e = ent.data as { plan?: string; status?: string } | null

  return {
    id: t.id,
    nome: t.name,
    slug: t.slug,
    situacao: t.status === 'suspended' ? 'suspensa' : 'ativa',
    plano: e?.plan ?? 'legacy',
    situacao_assinatura: e?.status ?? 'active',
    vinculada_em: (link as unknown as { created_at: string }).created_at?.slice(0, 10) ?? null,
    razao_social: p.corporate_name ?? null,
    cnpj: p.cnpj ?? null,
    email: p.email ?? null,
    telefone: p.phone ?? null,
    endereco: {
      cep: p.address_cep ?? null,
      logradouro: p.address_street ?? null,
      numero: p.address_number ?? null,
      complemento: p.address_complement ?? null,
      bairro: p.address_neighborhood ?? null,
      cidade: p.address_city ?? null,
      uf: p.address_uf ?? null,
    },
    responsavel_tecnico: {
      nome: p.tech_responsible_name ?? null,
      conselho: p.tech_responsible_council ?? null,
      registro: p.tech_responsible_registration ?? null,
    },
    contato: admin,
  }
}

/**
 * Administrador da clínica, para figurar como titular da conta no parceiro.
 *
 * O mais antigo entre os ativos, e um só. Devolver a lista inteira de admins
 * entregaria dado de pessoas que não têm relação com o parceiro; devolver o
 * mais recente faria o titular mudar sozinho a cada troca de equipe.
 */
async function findClinicAdmin(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ nome: string | null; email: string | null } | null> {
  const { data } = await supabase
    .from('user_tenants')
    .select('user_id, created_at, status')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
  const rows = (data ?? []) as unknown as Array<{
    user_id: string
    status: string | null
  }>
  const first = rows.find((r) => (r.status ?? 'active') === 'active') ?? rows[0]
  if (!first) return null

  // O nome vive em `user_profile`; o e-mail só existe em `auth.users` e sai
  // pela API de admin — mesmo caminho de `core/team/list.ts`.
  const [prof, authUser] = await Promise.all([
    supabase.from('user_profile').select('full_name').eq('user_id', first.user_id).maybeSingle(),
    supabase.auth.admin.getUserById(first.user_id).catch(() => null),
  ])
  const nome = (prof.data as { full_name?: string | null } | null)?.full_name ?? null
  const email = authUser?.data?.user?.email ?? null
  if (!nome && !email) return null
  return { nome, email }
}

// =========================================================================
// 3. Dados para emissão de nota
// =========================================================================

export interface PartnerBillingRecord {
  cobranca_id: string
  clinica: {
    id: string
    nome: string
    razao_social: string | null
    cnpj: string | null
    email: string | null
    endereco: PartnerClinicDetail['endereco']
  }
  /** Valor total cobrado da clínica, em centavos. */
  valor_total_centavos: number
  /** Quanto foi repassado ao parceiro nesta cobrança, em centavos. */
  valor_repasse_centavos: number
  vencimento: string
  pago_em: string | null
  situacao: string
}

/**
 * Cobranças com repasse a este parceiro, prontas para virar nota.
 *
 * PADRÃO: só as PAGAS. Nota fiscal de dinheiro que não entrou é o tipo de erro
 * que custa retificação — quem quiser enxergar a fila em aberto pede
 * `incluirPendentes`.
 *
 * O valor do repasse sai do SNAPSHOT gravado na emissão. Cobrança anterior à
 * regra de split atual (ou emitida quando o parceiro ainda não tinha carteira)
 * tem snapshot nulo; nesse caso recalculamos pela regra vigente apenas para
 * INFORMAR, nunca gravando — e a diferença, se houver, é conversa comercial.
 */
export async function listPartnerBillingRecords(
  supabase: SupabaseClient<Database>,
  partner: { id: string; splitPercentBps: number | null; splitFixedCents: number | null },
  opts: {
    from?: string
    to?: string
    incluirPendentes?: boolean
    pagina?: number
    porPagina?: number
  } = {},
): Promise<{ registros: PartnerBillingRecord[]; paginacao: Paginacao }> {
  const porPagina = Math.min(Math.max(opts.porPagina ?? 100, 1), MAX_POR_PAGINA)
  const pagina = Math.max(opts.pagina ?? 1, 1)
  const inicio = (pagina - 1) * porPagina
  const fim = inicio + porPagina - 1

  let q = supabase
    .from('billing_charges' as never)
    .select('id, tenant_id, amount_cents, split_amount_cents, due_date, paid_at, status', {
      count: 'exact',
    })
    .eq('partner_id', partner.id)
    .order('due_date', { ascending: false })
    .range(inicio, fim)
  if (!opts.incluirPendentes) q = q.in('status', ['confirmado', 'recebido'])
  if (opts.from) q = q.gte('due_date', opts.from)
  if (opts.to) q = q.lte('due_date', opts.to)

  const { data, error, count } = await q
  if (error) throw new Error(`listPartnerBillingRecords failed: ${error.message}`)

  const charges = (data ?? []) as unknown as Array<{
    id: string
    tenant_id: string
    amount_cents: number
    split_amount_cents: number | null
    due_date: string
    paid_at: string | null
    status: string
  }>

  const paginacao: Paginacao = {
    pagina,
    por_pagina: porPagina,
    total: count ?? charges.length,
    tem_proxima: (count ?? 0) > fim + 1,
  }
  if (charges.length === 0) return { registros: [], paginacao }

  const ids = [...new Set(charges.map((c) => c.tenant_id))]
  const [tenants, profiles] = await Promise.all([
    supabase.from('tenants').select('id, name').in('id', ids),
    supabase
      .from('tenant_clinic_profile')
      .select(
        'tenant_id, corporate_name, cnpj, email, address_cep, address_street, address_number, address_complement, address_neighborhood, address_city, address_uf',
      )
      .in('tenant_id', ids),
  ])

  const nameById = new Map(
    ((tenants.data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  )
  const profById = new Map(
    ((profiles.data ?? []) as unknown as Array<Record<string, string | null>>).map((p) => [
      p.tenant_id as string,
      p,
    ]),
  )

  const registros = charges.map((c) => {
    const p = profById.get(c.tenant_id) ?? {}
    const repasse =
      c.split_amount_cents ??
      splitAmountCents(c.amount_cents, {
        splitPercentBps: partner.splitPercentBps,
        splitFixedCents: partner.splitFixedCents,
      }) ??
      0
    return {
      cobranca_id: c.id,
      clinica: {
        id: c.tenant_id,
        nome: nameById.get(c.tenant_id) ?? '—',
        razao_social: p.corporate_name ?? null,
        cnpj: p.cnpj ?? null,
        email: p.email ?? null,
        endereco: {
          cep: p.address_cep ?? null,
          logradouro: p.address_street ?? null,
          numero: p.address_number ?? null,
          complemento: p.address_complement ?? null,
          bairro: p.address_neighborhood ?? null,
          cidade: p.address_city ?? null,
          uf: p.address_uf ?? null,
        },
      },
      valor_total_centavos: c.amount_cents,
      valor_repasse_centavos: repasse,
      vencimento: c.due_date,
      pago_em: c.paid_at ? c.paid_at.slice(0, 10) : null,
      situacao: c.status,
    }
  })

  return { registros, paginacao }
}
