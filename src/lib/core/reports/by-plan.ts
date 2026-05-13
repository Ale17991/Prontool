import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { applyPlanTax } from './apply-plan-tax'

/**
 * Agregadores para o relatorio "Por Plano":
 *   - summaryByPlan(period) → uma linha por plano com contagem e total
 *   - detailByPlan(planId, period) → tabela linha-a-linha de procedimentos
 *
 * Apos a feature de multi-procedimento (migration 0069), cada atendimento
 * pode ter N linhas de procedimento, cada uma com seu proprio plano. As
 * agregacoes operam sobre `appointment_procedures` joined com
 * `appointments_effective` (para filtrar estornos).
 *
 * Compatibilidade: atendimentos antigos foram backfilled em
 * appointment_procedures com sequence=1, entao o comportamento e identico
 * para dados pre-existentes.
 *
 * Particular (sem plano): linhas com appointment_procedures.plan_id IS NULL
 * sao agregadas sob o sentinel PARTICULAR_KEY. summaryByPlan retorna a
 * linha de particular junto com as demais — a pagina expoe um card
 * proprio. detailByPlan aceita planId=null para listar somente particular.
 */
export const PARTICULAR_KEY = 'particular' as const

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export interface PlanSummaryRow {
  planId: string
  planName: string
  procedureCount: number
  totalRevenueCents: number
  // Feature 011 — US4
  taxRateBps: number
  taxFromPlanCents: number
  netOfPlanTaxCents: number
}

export interface PlanProcedureRow {
  appointmentId: string
  appointmentAt: string
  patientId: string
  patientName: string
  procedureId: string
  tussCode: string
  procedureName: string
  doctorId: string
  doctorName: string
  amountCents: number
  status: 'ativo'
}

export interface PlanDetail {
  plan: { id: string; name: string }
  period: { from: string; to: string }
  procedures: PlanProcedureRow[]
  totals: {
    procedureCount: number
    totalRevenueCents: number
    // Feature 011 — US4
    taxRateBps: number
    taxFromPlanCents: number
    netOfPlanTaxCents: number
  }
  topDoctor: { doctorId: string; doctorName: string; count: number } | null
  topProcedure: {
    procedureId: string
    procedureName: string
    tussCode: string
    count: number
  } | null
}

interface ActiveAppointmentRow {
  id: string
  patient_id: string
  doctor_id: string
  appointment_at: string
  effective_status: string | null
  doctors: { id: string; full_name: string } | null
}

interface LineRow {
  appointment_id: string
  procedure_id: string
  plan_id: string | null
  line_amount_cents: number
  procedures: { id: string; tuss_code: string; display_name: string | null } | null
  health_plans: { id: string; name: string } | null
}

interface DecryptedNameRow {
  id: string
  full_name: string | null
  anonymized_at: string | null
}

export async function summaryByPlan(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; from: string; to: string },
): Promise<PlanSummaryRow[]> {
  validatePeriod(input.from, input.to)

  const fromTs = `${input.from}T00:00:00Z`
  const toExclusive = nextDayIso(input.to)

  // 1) Atendimentos ATIVOS no periodo.
  const activeIds = await fetchActiveAppointmentIds(
    supabase,
    input.tenantId,
    fromTs,
    toExclusive,
  )
  if (activeIds.length === 0) return []

  // 2) Linhas desses atendimentos.
  const lines = await fetchLines(supabase, input.tenantId, activeIds)

  // 3) Agrega por plano (sem aplicar imposto ainda). Particular agrega sob
  // PARTICULAR_KEY — a pagina renderiza o card "Particular" separado.
  type RawRow = {
    planId: string
    planName: string
    procedureCount: number
    totalRevenueCents: number
  }
  const map = new Map<string, RawRow>()
  for (const l of lines) {
    const key = l.plan_id ?? PARTICULAR_KEY
    const existing = map.get(key) ?? {
      planId: l.plan_id ?? PARTICULAR_KEY,
      planName: l.health_plans?.name ?? 'Particular',
      procedureCount: 0,
      totalRevenueCents: 0,
    }
    existing.procedureCount += 1
    existing.totalRevenueCents += l.line_amount_cents
    map.set(key, existing)
  }
  const raw = Array.from(map.values())

  // 4) Carrega tax_rate_bps dos planos envolvidos (Feature 011 — US4).
  // Particular nao tem health_plan, entao filtramos o sentinel antes do lookup.
  const planTaxMap = await fetchPlanTaxRates(
    supabase,
    input.tenantId,
    raw.map((r) => r.planId).filter((id) => id !== PARTICULAR_KEY),
  )

  // 5) Aplica imposto e enriquece. applyPlanTax usa o campo grossRevenueCents,
  // mas aqui temos totalRevenueCents — mapeamos via adapter.
  const adapted = raw.map((r) => ({
    ...r,
    grossRevenueCents: r.totalRevenueCents,
  }))
  const { rows: enriched } = applyPlanTax(adapted, planTaxMap)
  const out: PlanSummaryRow[] = enriched.map((r) => ({
    planId: r.planId,
    planName: r.planName,
    procedureCount: r.procedureCount,
    totalRevenueCents: r.totalRevenueCents,
    taxRateBps: r.taxRateBps,
    taxFromPlanCents: r.taxFromPlanCents,
    netOfPlanTaxCents: r.netOfPlanTaxCents,
  }))
  return out.sort((a, b) => b.totalRevenueCents - a.totalRevenueCents)
}

/**
 * Feature 011 — US4 — carrega tax_rate_bps de planos por id.
 * Retorna Map<planId, taxRateBps>. Planos não encontrados ou particular
 * (planId vazio) usam fallback 0 no consumidor.
 */
async function fetchPlanTaxRates(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  planIds: string[],
): Promise<Map<string, number>> {
  if (planIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('health_plans')
    .select('id, tax_rate_bps')
    .eq('tenant_id', tenantId)
    .in('id', planIds)
  if (error) throw new Error(`fetchPlanTaxRates failed: ${error.message}`)
  const map = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ id: string; tax_rate_bps?: number }>) {
    map.set(row.id, row.tax_rate_bps ?? 0)
  }
  return map
}

export async function detailByPlan(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; planId: string | null; from: string; to: string },
): Promise<PlanDetail> {
  validatePeriod(input.from, input.to)

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to decrypt patient names')
  }

  // planId === null => listagem de procedimentos particulares (plan_id IS NULL
  // em appointment_procedures). O sentinel exposto na URL e no plan.id e
  // PARTICULAR_KEY ('particular'). `?? PARTICULAR_KEY` serve pra ambos os
  // ramos e da pro TS um `string` (em vez de `string | null`).
  const planIdForExports: string = input.planId ?? PARTICULAR_KEY

  const fromTs = `${input.from}T00:00:00Z`
  const toExclusive = nextDayIso(input.to)

  // 1) Atendimentos ATIVOS no periodo (com dados do profissional).
  const active = await fetchActiveAppointments(
    supabase,
    input.tenantId,
    fromTs,
    toExclusive,
  )
  if (active.length === 0) {
    const planFallback =
      input.planId === null
        ? 'Particular'
        : await ensurePlanName(supabase, input.tenantId, input.planId, null)
    return {
      plan: { id: planIdForExports, name: planFallback },
      period: { from: input.from, to: input.to },
      procedures: [],
      totals: {
        procedureCount: 0,
        totalRevenueCents: 0,
        taxRateBps: 0,
        taxFromPlanCents: 0,
        netOfPlanTaxCents: 0,
      },
      topDoctor: null,
      topProcedure: null,
    }
  }

  const appointmentById = new Map<string, ActiveAppointmentRow>()
  for (const a of active) appointmentById.set(a.id, a)

  // 2) Todas as linhas desses atendimentos, FILTRADAS pelo plan_id.
  // null === null em JS, entao o filtro abaixo cobre particular e plano UUID
  // com a mesma expressao.
  const allLines = await fetchLines(
    supabase,
    input.tenantId,
    active.map((a) => a.id),
  )
  const lines = allLines.filter((l) => l.plan_id === input.planId)

  // 3) Nome do plano: para particular usamos rotulo fixo. Para planos
  // normais, prioriza um line.health_plans.name (evita query extra) e cai
  // pra health_plans table como fallback.
  const planFallback =
    input.planId === null
      ? 'Particular'
      : await ensurePlanName(
          supabase,
          input.tenantId,
          input.planId,
          lines.find((l) => l.health_plans?.name)?.health_plans?.name ?? null,
        )

  // 4) Decifra nomes de pacientes (somente dos atendimentos com linhas).
  const patientIds = Array.from(
    new Set(
      lines
        .map((l) => appointmentById.get(l.appointment_id)?.patient_id)
        .filter((v): v is string => typeof v === 'string'),
    ),
  )
  const namesMap = await decryptPatientNames(supabase, input.tenantId, patientIds, key)

  // 5) Monta linhas do relatorio (uma linha = uma procedure_line).
  const procedures: PlanProcedureRow[] = lines.map((l) => {
    const a = appointmentById.get(l.appointment_id)
    return {
      appointmentId: l.appointment_id,
      appointmentAt: a?.appointment_at ?? '',
      patientId: a?.patient_id ?? '',
      patientName: a?.patient_id ? namesMap.get(a.patient_id) ?? '—' : '—',
      procedureId: l.procedure_id,
      tussCode: l.procedures?.tuss_code ?? '',
      procedureName: l.procedures?.display_name ?? l.procedures?.tuss_code ?? 'Sem nome',
      doctorId: a?.doctor_id ?? '',
      doctorName: a?.doctors?.full_name ?? '—',
      amountCents: l.line_amount_cents,
      status: 'ativo' as const,
    }
  })

  // Ordem: appointment_at ASC, depois appointment_id.
  procedures.sort((a, b) => {
    if (a.appointmentAt < b.appointmentAt) return -1
    if (a.appointmentAt > b.appointmentAt) return 1
    if (a.appointmentId < b.appointmentId) return -1
    if (a.appointmentId > b.appointmentId) return 1
    return 0
  })

  const procedureCount = procedures.length
  const totalRevenueCents = procedures.reduce((acc, p) => acc + p.amountCents, 0)

  // Top doctor + top procedure
  const doctorCounts = new Map<string, { doctorId: string; doctorName: string; count: number }>()
  const procedureCounts = new Map<
    string,
    { procedureId: string; procedureName: string; tussCode: string; count: number }
  >()
  for (const row of procedures) {
    const dExisting = doctorCounts.get(row.doctorId) ?? {
      doctorId: row.doctorId,
      doctorName: row.doctorName,
      count: 0,
    }
    dExisting.count += 1
    doctorCounts.set(row.doctorId, dExisting)

    const pExisting = procedureCounts.get(row.procedureId) ?? {
      procedureId: row.procedureId,
      procedureName: row.procedureName,
      tussCode: row.tussCode,
      count: 0,
    }
    pExisting.count += 1
    procedureCounts.set(row.procedureId, pExisting)
  }
  const topDoctor =
    Array.from(doctorCounts.values()).sort((a, b) => b.count - a.count)[0] ?? null
  const topProcedure =
    Array.from(procedureCounts.values()).sort((a, b) => b.count - a.count)[0] ?? null

  // Feature 011 — US4: aplica tax_rate_bps do plano sobre o total. Particular
  // nao tem health_plan, entao pula-se o lookup e a taxa fica em 0.
  const planTaxMap =
    input.planId === null
      ? new Map<string, number>()
      : await fetchPlanTaxRates(supabase, input.tenantId, [input.planId])
  const { rows: enriched } = applyPlanTax(
    [{ planId: planIdForExports, grossRevenueCents: totalRevenueCents }],
    planTaxMap,
  )
  const taxRow = enriched[0]!

  return {
    plan: { id: planIdForExports, name: planFallback },
    period: { from: input.from, to: input.to },
    procedures,
    totals: {
      procedureCount,
      totalRevenueCents,
      taxRateBps: taxRow.taxRateBps,
      taxFromPlanCents: taxRow.taxFromPlanCents,
      netOfPlanTaxCents: taxRow.netOfPlanTaxCents,
    },
    topDoctor,
    topProcedure,
  }
}

async function fetchActiveAppointmentIds(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  fromTs: string,
  toExclusive: string,
): Promise<string[]> {
  const PAGE_SIZE = 1000
  const ids: string[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('appointments_effective')
      .select('id, effective_status')
      .eq('tenant_id', tenantId)
      .gte('appointment_at', fromTs)
      .lt('appointment_at', toExclusive)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`fetchActiveAppointmentIds failed: ${error.message}`)
    const page = (data ?? []) as Array<{ id: string; effective_status: string | null }>
    for (const r of page) {
      if (r.effective_status === 'ativo') ids.push(r.id)
    }
    if (page.length < PAGE_SIZE) break
  }
  return ids
}

async function fetchActiveAppointments(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  fromTs: string,
  toExclusive: string,
): Promise<ActiveAppointmentRow[]> {
  const PAGE_SIZE = 1000
  const rows: ActiveAppointmentRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('appointments_effective')
      .select(
        'id, patient_id, doctor_id, appointment_at, effective_status, doctors:doctor_id(id, full_name)',
      )
      .eq('tenant_id', tenantId)
      .gte('appointment_at', fromTs)
      .lt('appointment_at', toExclusive)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`fetchActiveAppointments failed: ${error.message}`)
    const page = (data ?? []) as unknown as ActiveAppointmentRow[]
    for (const r of page) {
      if (r.effective_status === 'ativo') rows.push(r)
    }
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

async function fetchLines(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentIds: string[],
): Promise<LineRow[]> {
  if (appointmentIds.length === 0) return []
  const PAGE_SIZE = 1000
  const CHUNK = 500
  const all: LineRow[] = []
  for (let i = 0; i < appointmentIds.length; i += CHUNK) {
    const ids = appointmentIds.slice(i, i + CHUNK)
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('appointment_procedures' as never)
        .select(
          'appointment_id, procedure_id, plan_id, line_amount_cents, ' +
            'procedures:procedure_id(id, tuss_code, display_name), health_plans:plan_id(id, name)',
        )
        .eq('tenant_id', tenantId)
        .in('appointment_id', ids)
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) {
        if (/relation .*appointment_procedures.* does not exist/i.test(error.message)) {
          return []
        }
        throw new Error(`fetchLines failed: ${error.message}`)
      }
      const page = (data ?? []) as unknown as LineRow[]
      all.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  }
  return all
}

async function decryptPatientNames(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientIds: string[],
  key: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (patientIds.length === 0) return result

  const { data, error } = await supabase.rpc('decrypt_patient_names_for_ids', {
    p_tenant_id: tenantId,
    p_patient_ids: patientIds,
    p_key: key,
  })
  if (error) throw new Error(`decrypt_patient_names_for_ids failed: ${error.message}`)

  for (const row of (data ?? []) as unknown as DecryptedNameRow[]) {
    result.set(
      row.id,
      row.anonymized_at ? '[anonimizado]' : row.full_name ?? '(sem nome)',
    )
  }
  return result
}

async function ensurePlanName(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  planId: string,
  fromQuery: string | null,
): Promise<string> {
  if (fromQuery) return fromQuery
  const { data } = await supabase
    .from('health_plans')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('id', planId)
    .maybeSingle()
  return data?.name ?? 'Plano'
}

function validatePeriod(from: string, to: string): void {
  if (!DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
    throw new ValidationError('Parâmetros from/to devem estar no formato YYYY-MM-DD')
  }
  if (from > to) {
    throw new ValidationError('Parâmetro `from` não pode ser posterior a `to`')
  }
}

function nextDayIso(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}
