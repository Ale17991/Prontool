/**
 * O financeiro da CLÍNICA visto pelo parceiro, para ele emitir a nota fiscal
 * sem que ninguém redigite nada.
 *
 * Atenção ao escopo: aqui NÃO é a assinatura que a clínica paga à Clinni (isso
 * é `core/billing/`). Aqui é o que a clínica cobrou dos pacientes dela — o
 * faturamento sobre o qual a nota é emitida.
 *
 * TRÊS RECORTES, porque são três perguntas diferentes e o parceiro faz as três:
 *   - serviços prestados  → o que foi feito (a descrição do serviço na nota)
 *   - cobranças           → o que foi combinado (valor, parcelas, vencimentos)
 *   - movimentações       → o que entrou e saiu de caixa, com data
 * Uma lista só não serviria: atendimento sem cobrança existe (cortesia,
 * convênio), cobrança sem atendimento existe (pacote, plano de tratamento), e
 * a data do serviço não é a data do dinheiro.
 *
 * O QUE NUNCA SAI: diagnóstico, anamnese, evolução, prontuário, medição,
 * qualquer conteúdo clínico. Do atendimento sai o procedimento (que é a
 * descrição do serviço, obrigatória na nota) e o valor. Do paciente saem nome e
 * CPF (que é o tomador), e nada mais.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { varrerAte } from './scan'

/** Teto de página. O PostgREST corta em 1.000 sem avisar; aqui o corte é nosso e é dito. */
export const MAX_POR_PAGINA = 200
const DEFAULT_POR_PAGINA = 100

/**
 * Quantas movimentações um único período pode ter.
 *
 * `/movimentacoes` funde duas origens com colunas de data diferentes, então a
 * ordenação e os totais só existem depois de trazer as duas por inteiro — não
 * há paginação no banco que produza a lista correta. O teto existe para que
 * isso nunca vire uma varredura ilimitada.
 *
 * Estourar o teto responde 400 pedindo período menor. NÃO devolve os primeiros
 * N em silêncio: quem soma a resposta acredita que somou o mês, e um
 * fechamento a menos é pior que uma consulta recusada.
 */
export const MAX_MOVIMENTACOES_PERIODO = 20_000

const PERIODO_LONGO_DEMAIS =
  `Este período tem mais de ${MAX_MOVIMENTACOES_PERIODO.toLocaleString('pt-BR')} movimentações. ` +
  'Consulte por intervalos menores (por exemplo, mês a mês).'

export interface Paginacao {
  pagina: number
  por_pagina: number
  total: number
  /** `true` quando ainda há página adiante — evita o parceiro ter que adivinhar. */
  tem_proxima: boolean
}

export interface Periodo {
  from?: string
  to?: string
  pagina?: number
  porPagina?: number
}

function faixa(opts: Periodo): {
  fromIdx: number
  toIdx: number
  pagina: number
  porPagina: number
} {
  const porPagina = Math.min(Math.max(opts.porPagina ?? DEFAULT_POR_PAGINA, 1), MAX_POR_PAGINA)
  const pagina = Math.max(opts.pagina ?? 1, 1)
  const fromIdx = (pagina - 1) * porPagina
  return { fromIdx, toIdx: fromIdx + porPagina - 1, pagina, porPagina }
}

// =========================================================================
// Identificação do paciente (tomador da nota)
// =========================================================================

export interface Tomador {
  id: string
  nome: string | null
  cpf: string | null
}

/**
 * Nome e CPF de vários pacientes, decifrados em lote pela RPC da 0214.
 *
 * Paciente anonimizado volta sem identificação — a RPC o ignora, e aqui ele
 * fica com `nome: null`. O registro financeiro dele CONTINUA na lista: o
 * dinheiro entrou e a contabilidade não pode perder a linha porque a pessoa
 * exerceu o direito de sumir. O que se apaga é quem, não quanto.
 */
async function tomadores(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientIds: string[],
): Promise<Map<string, Tomador>> {
  const out = new Map<string, Tomador>()
  const ids = [...new Set(patientIds)].filter(Boolean)
  if (ids.length === 0) return out

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to identify tomador')

  const { data, error } = await supabase.rpc(
    'patient_identities_for_billing' as never,
    { p_tenant_id: tenantId, p_patient_ids: ids, p_key: key } as never,
  )
  if (error) {
    logger.error({ err: error.message }, 'partner-tomadores-failed')
    throw new Error(`patient_identities_for_billing failed: ${error.message}`)
  }

  for (const r of (data ?? []) as unknown as Array<{
    id: string
    full_name: string | null
    cpf: string | null
  }>) {
    out.set(r.id, { id: r.id, nome: r.full_name, cpf: r.cpf })
  }
  // Quem não voltou (anonimizado) entra identificado só pelo id.
  for (const id of ids) {
    if (!out.has(id)) out.set(id, { id, nome: null, cpf: null })
  }
  return out
}

// =========================================================================
// 1. Serviços prestados
// =========================================================================

export interface ServicoPrestado {
  atendimento_id: string
  data: string
  tomador: Tomador
  /** `registro` é o número no conselho (ex.: "ES-31882"), vindo do cadastro. */
  profissional: { nome: string; registro: string } | null
  convenio: string | null
  procedimentos: Array<{
    codigo_tuss: string
    descricao: string | null
    valor_centavos: number
  }>
  valor_centavos: number
  /** 'ativo' | 'estornado'. Estornado NÃO some da lista — ver comentário. */
  situacao: string
}

/**
 * Atendimentos realizados no período.
 *
 * Sai de `appointments_effective`, não de `appointments`: é a view que aplica
 * o estorno. E o estornado **continua na lista**, marcado — sumir com ele
 * esconderia do parceiro exatamente o caso em que uma nota já emitida precisa
 * ser cancelada. `valor_centavos` já é o LÍQUIDO do estorno (zero, quando
 * integral), então quem soma a lista soma o faturamento correto sem saber da
 * regra.
 */
export async function listPartnerServices(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: Periodo = {},
): Promise<{ servicos: ServicoPrestado[]; paginacao: Paginacao }> {
  const { fromIdx, toIdx, pagina, porPagina } = faixa(opts)

  let q = supabase
    .from('appointments_effective')
    .select(
      'id, patient_id, doctor_id, procedure_id, plan_id, appointment_at, net_amount_cents, effective_status',
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .order('appointment_at', { ascending: false })
    .range(fromIdx, toIdx)
  if (opts.from) q = q.gte('appointment_at', `${opts.from}T00:00:00Z`)
  if (opts.to) q = q.lte('appointment_at', `${opts.to}T23:59:59Z`)

  const { data, error, count } = await q
  if (error) throw new Error(`listPartnerServices failed: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    patient_id: string
    doctor_id: string
    procedure_id: string
    plan_id: string | null
    appointment_at: string
    net_amount_cents: number
    effective_status: string
  }>

  const paginacao: Paginacao = {
    pagina,
    por_pagina: porPagina,
    total: count ?? rows.length,
    tem_proxima: (count ?? 0) > toIdx + 1,
  }
  if (rows.length === 0) return { servicos: [], paginacao }

  const apptIds = rows.map((r) => r.id)
  const [ident, docs, plans, linhas] = await Promise.all([
    tomadores(
      supabase,
      tenantId,
      rows.map((r) => r.patient_id),
    ),
    supabase
      .from('doctors')
      .select('id, full_name, crm')
      .in('id', [...new Set(rows.map((r) => r.doctor_id))]),
    supabase
      .from('health_plans')
      .select('id, name')
      .in('id', [...new Set(rows.map((r) => r.plan_id).filter(Boolean) as string[])]),
    supabase
      .from('appointment_procedures')
      .select('appointment_id, procedure_id, line_amount_cents, sequence')
      .eq('tenant_id', tenantId)
      .in('appointment_id', apptIds)
      .order('sequence'),
  ])

  const docById = new Map(
    ((docs.data ?? []) as Array<{ id: string; full_name: string; crm: string }>).map((d) => [
      d.id,
      d,
    ]),
  )
  const planById = new Map(
    ((plans.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  )

  const linhaRows = (linhas.data ?? []) as unknown as Array<{
    appointment_id: string
    procedure_id: string
    line_amount_cents: number
  }>
  // O procedimento do cabeçalho do atendimento entra quando não há linhas
  // detalhadas — atendimento simples não popula `appointment_procedures`, e
  // uma nota sem descrição de serviço não pode ser emitida.
  const procIds = [
    ...new Set([...linhaRows.map((l) => l.procedure_id), ...rows.map((r) => r.procedure_id)]),
  ]
  const { data: procs } = await supabase
    .from('procedures')
    .select('id, tuss_code, display_name')
    .in('id', procIds)
  const procById = new Map(
    ((procs ?? []) as Array<{ id: string; tuss_code: string; display_name: string | null }>).map(
      (p) => [p.id, p],
    ),
  )

  const linhasPorAtendimento = new Map<string, ServicoPrestado['procedimentos']>()
  for (const l of linhaRows) {
    const p = procById.get(l.procedure_id)
    const arr = linhasPorAtendimento.get(l.appointment_id) ?? []
    arr.push({
      codigo_tuss: p?.tuss_code ?? '',
      descricao: p?.display_name ?? null,
      valor_centavos: l.line_amount_cents,
    })
    linhasPorAtendimento.set(l.appointment_id, arr)
  }

  const servicos = rows.map((r) => {
    const doc = docById.get(r.doctor_id)
    const cab = procById.get(r.procedure_id)
    const procedimentos = linhasPorAtendimento.get(r.id) ?? [
      {
        codigo_tuss: cab?.tuss_code ?? '',
        descricao: cab?.display_name ?? null,
        valor_centavos: r.net_amount_cents,
      },
    ]
    return {
      atendimento_id: r.id,
      data: r.appointment_at,
      tomador: ident.get(r.patient_id) ?? { id: r.patient_id, nome: null, cpf: null },
      profissional: doc ? { nome: doc.full_name, registro: doc.crm } : null,
      convenio: r.plan_id ? (planById.get(r.plan_id) ?? null) : null,
      procedimentos,
      valor_centavos: r.net_amount_cents,
      situacao: r.effective_status,
    }
  })

  return { servicos, paginacao }
}

// =========================================================================
// 2. Cobranças realizadas
// =========================================================================

export interface CobrancaRealizada {
  cobranca_id: string
  criada_em: string
  tomador: Tomador
  atendimento_id: string | null
  valor_total_centavos: number
  valor_pago_centavos: number
  forma_pagamento: string
  situacao: string
  pago_em: string | null
  parcelas: Array<{
    numero: number
    valor_centavos: number
    vencimento: string
    situacao: string
    pago_em: string | null
    valor_pago_centavos: number
    forma_pagamento: string | null
  }>
}

export async function listPartnerCharges(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: Periodo = {},
): Promise<{ cobrancas: CobrancaRealizada[]; paginacao: Paginacao }> {
  const { fromIdx, toIdx, pagina, porPagina } = faixa(opts)

  let q = supabase
    .from('payment_records')
    .select(
      'id, patient_id, appointment_id, total_amount_cents, paid_amount_cents, payment_method, payment_status, paid_at, created_at',
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range(fromIdx, toIdx)
  if (opts.from) q = q.gte('created_at', `${opts.from}T00:00:00Z`)
  if (opts.to) q = q.lte('created_at', `${opts.to}T23:59:59Z`)

  const { data, error, count } = await q
  if (error) throw new Error(`listPartnerCharges failed: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    patient_id: string
    appointment_id: string | null
    total_amount_cents: number
    paid_amount_cents: number
    payment_method: string
    payment_status: string
    paid_at: string | null
    created_at: string
  }>

  const paginacao: Paginacao = {
    pagina,
    por_pagina: porPagina,
    total: count ?? rows.length,
    tem_proxima: (count ?? 0) > toIdx + 1,
  }
  if (rows.length === 0) return { cobrancas: [], paginacao }

  const [ident, parcelas] = await Promise.all([
    tomadores(
      supabase,
      tenantId,
      rows.map((r) => r.patient_id),
    ),
    supabase
      .from('payment_installments')
      .select(
        'payment_record_id, installment_number, amount_cents, due_date, status, paid_at, paid_amount_cents, payment_method',
      )
      .eq('tenant_id', tenantId)
      .in(
        'payment_record_id',
        rows.map((r) => r.id),
      )
      .order('installment_number'),
  ])

  const porCobranca = new Map<string, CobrancaRealizada['parcelas']>()
  for (const p of (parcelas.data ?? []) as unknown as Array<{
    payment_record_id: string
    installment_number: number
    amount_cents: number
    due_date: string
    status: string
    paid_at: string | null
    paid_amount_cents: number
    payment_method: string | null
  }>) {
    const arr = porCobranca.get(p.payment_record_id) ?? []
    arr.push({
      numero: p.installment_number,
      valor_centavos: p.amount_cents,
      vencimento: p.due_date,
      situacao: p.status,
      pago_em: p.paid_at,
      valor_pago_centavos: p.paid_amount_cents,
      forma_pagamento: p.payment_method,
    })
    porCobranca.set(p.payment_record_id, arr)
  }

  return {
    cobrancas: rows.map((r) => ({
      cobranca_id: r.id,
      criada_em: r.created_at,
      tomador: ident.get(r.patient_id) ?? { id: r.patient_id, nome: null, cpf: null },
      atendimento_id: r.appointment_id,
      valor_total_centavos: r.total_amount_cents,
      valor_pago_centavos: r.paid_amount_cents,
      forma_pagamento: r.payment_method,
      situacao: r.payment_status,
      pago_em: r.paid_at,
      parcelas: porCobranca.get(r.id) ?? [],
    })),
    paginacao,
  }
}

// =========================================================================
// 3. Movimentações financeiras
// =========================================================================

export interface Movimentacao {
  tipo: 'entrada' | 'saida'
  /** AAAA-MM-DD — data do FATO financeiro, não da criação do registro. */
  data: string
  valor_centavos: number
  descricao: string
  categoria: string | null
  forma_pagamento: string | null
  /** Id do registro de origem, para o parceiro cruzar com as outras listas. */
  origem_id: string
  origem: 'parcela' | 'despesa'
  tomador: Tomador | null
}

/**
 * Entradas e saídas de caixa no período, numa lista só e ordenada por data.
 *
 * ENTRADA é a PARCELA PAGA, não a cobrança: é o pagamento que move o caixa, e
 * uma cobrança em 6x move seis vezes, em seis datas. Emitir nota pela data da
 * cobrança poria seis meses de receita na competência do primeiro mês.
 *
 * `paid_at` é TIMESTAMPTZ e vira dia civil da clínica; `competence_date` da
 * despesa já é DATE e não tem fuso. Misturar os dois sem essa distinção
 * empurraria o pagamento das 21h para o dia seguinte — a mesma armadilha que a
 * 054 firmou entre `brDate` e `brDateTz`.
 */
export async function listPartnerCashFlow(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: Periodo & { tipo?: 'entrada' | 'saida' } = {},
): Promise<{
  movimentacoes: Movimentacao[]
  paginacao: Paginacao
  total_entradas_centavos: number
  total_saidas_centavos: number
}> {
  const { pagina, porPagina } = faixa(opts)

  const entradas: Movimentacao[] = []
  const saidas: Movimentacao[] = []

  if (opts.tipo !== 'saida') {
    const rows = await varrerAte<{
      id: string
      payment_record_id: string
      installment_number: number
      paid_at: string
      paid_amount_cents: number
      payment_method: string | null
    }>(
      (de, ate) => {
        let q = supabase
          .from('payment_installments')
          .select(
            'id, payment_record_id, installment_number, paid_at, paid_amount_cents, payment_method',
          )
          .eq('tenant_id', tenantId)
          .eq('status', 'pago')
          .not('paid_at', 'is', null)
          .order('paid_at', { ascending: false })
          .range(de, ate)
        if (opts.from) q = q.gte('paid_at', `${opts.from}T00:00:00Z`)
        if (opts.to) q = q.lte('paid_at', `${opts.to}T23:59:59Z`)
        return q
      },
      MAX_MOVIMENTACOES_PERIODO,
      'listPartnerCashFlow (entradas)',
      PERIODO_LONGO_DEMAIS,
    )

    // Paciente da parcela vem pela cobrança-mãe.
    const recIds = [...new Set(rows.map((r) => r.payment_record_id))]
    const { data: recs } = recIds.length
      ? await supabase
          .from('payment_records')
          .select('id, patient_id')
          .eq('tenant_id', tenantId)
          .in('id', recIds)
      : { data: [] as Array<{ id: string; patient_id: string }> }
    const patByRec = new Map(
      ((recs ?? []) as Array<{ id: string; patient_id: string }>).map((r) => [r.id, r.patient_id]),
    )
    const ident = await tomadores(supabase, tenantId, [...patByRec.values()])

    for (const r of rows) {
      const patientId = patByRec.get(r.payment_record_id)
      entradas.push({
        tipo: 'entrada',
        data: diaCivil(r.paid_at),
        valor_centavos: r.paid_amount_cents,
        descricao: `Recebimento — parcela ${r.installment_number}`,
        categoria: 'recebimento',
        forma_pagamento: r.payment_method,
        origem_id: r.id,
        origem: 'parcela',
        tomador: patientId ? (ident.get(patientId) ?? null) : null,
      })
    }
  }

  if (opts.tipo !== 'entrada') {
    const despesas = await varrerAte<{
      id: string
      category: string
      description: string
      supplier: string | null
      amount_cents: number
      competence_date: string
    }>(
      (de, ate) => {
        let q = supabase
          .from('expenses')
          .select('id, category, description, supplier, amount_cents, competence_date')
          .eq('tenant_id', tenantId)
          .is('deleted_at', null)
          .order('competence_date', { ascending: false })
          .range(de, ate)
        if (opts.from) q = q.gte('competence_date', opts.from)
        if (opts.to) q = q.lte('competence_date', opts.to)
        return q
      },
      MAX_MOVIMENTACOES_PERIODO,
      'listPartnerCashFlow (saidas)',
      PERIODO_LONGO_DEMAIS,
    )
    for (const e of despesas) {
      saidas.push({
        tipo: 'saida',
        data: e.competence_date,
        valor_centavos: e.amount_cents,
        descricao: e.supplier ? `${e.description} — ${e.supplier}` : e.description,
        categoria: e.category,
        forma_pagamento: null,
        origem_id: e.id,
        origem: 'despesa',
        tomador: null,
      })
    }
  }

  const todas = [...entradas, ...saidas].sort((a, b) => b.data.localeCompare(a.data))
  const inicio = (pagina - 1) * porPagina
  const pagina_atual = todas.slice(inicio, inicio + porPagina)

  return {
    movimentacoes: pagina_atual,
    paginacao: {
      pagina,
      por_pagina: porPagina,
      total: todas.length,
      tem_proxima: todas.length > inicio + porPagina,
    },
    total_entradas_centavos: entradas.reduce((s, m) => s + m.valor_centavos, 0),
    total_saidas_centavos: saidas.reduce((s, m) => s + m.valor_centavos, 0),
  }
}

/** TIMESTAMPTZ → dia civil no fuso da clínica (padrão do produto). */
function diaCivil(ts: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.CLINIC_TIMEZONE || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts))
}
