import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'

/**
 * Agregadores para o relatório "Por Plano":
 *   - summaryByPlan(period) → uma linha por plano com contagem e total
 *   - detailByPlan(planId, period) → tabela linha-a-linha de atendimentos
 *
 * Ambos consideram apenas appointments_effective com `effective_status='ativo'`
 * (estornados saem da contagem e do faturamento). Nomes de pacientes vêm
 * decifrados via RPC `decrypt_patient_names_for_ids` (tenant + key).
 */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export interface PlanSummaryRow {
  planId: string
  planName: string
  procedureCount: number
  totalRevenueCents: number
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
  }
  topDoctor: { doctorId: string; doctorName: string; count: number } | null
  topProcedure: {
    procedureId: string
    procedureName: string
    tussCode: string
    count: number
  } | null
}

interface SummaryRow {
  plan_id: string
  net_amount_cents: number | null
  effective_status: string | null
  health_plans: { name: string } | null
}

interface DetailRow {
  id: string
  plan_id: string
  patient_id: string
  procedure_id: string
  doctor_id: string
  appointment_at: string
  net_amount_cents: number | null
  effective_status: string | null
  health_plans: { id: string; name: string } | null
  procedures: { id: string; tuss_code: string; display_name: string | null } | null
  doctors: { id: string; full_name: string } | null
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

  const PAGE_SIZE = 1000
  const rows: SummaryRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('appointments_effective')
      .select('plan_id, net_amount_cents, effective_status, health_plans(name)')
      .eq('tenant_id', input.tenantId)
      .gte('appointment_at', fromTs)
      .lt('appointment_at', toExclusive)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`summaryByPlan query failed: ${error.message}`)
    const page = (data ?? []) as unknown as SummaryRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const map = new Map<string, PlanSummaryRow>()
  for (const r of rows) {
    if (r.effective_status !== 'ativo') continue
    const existing = map.get(r.plan_id) ?? {
      planId: r.plan_id,
      planName: r.health_plans?.name ?? 'Particular',
      procedureCount: 0,
      totalRevenueCents: 0,
    }
    existing.procedureCount += 1
    existing.totalRevenueCents += r.net_amount_cents ?? 0
    map.set(r.plan_id, existing)
  }

  return Array.from(map.values()).sort(
    (a, b) => b.totalRevenueCents - a.totalRevenueCents,
  )
}

export async function detailByPlan(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; planId: string; from: string; to: string },
): Promise<PlanDetail> {
  validatePeriod(input.from, input.to)

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to decrypt patient names')
  }

  const fromTs = `${input.from}T00:00:00Z`
  const toExclusive = nextDayIso(input.to)

  const PAGE_SIZE = 1000
  const raw: DetailRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('appointments_effective')
      .select(
        'id, plan_id, patient_id, procedure_id, doctor_id, appointment_at, net_amount_cents, effective_status, ' +
          'health_plans:plan_id(id, name), procedures:procedure_id(id, tuss_code, display_name), doctors:doctor_id(id, full_name)',
      )
      .eq('tenant_id', input.tenantId)
      .eq('plan_id', input.planId)
      .gte('appointment_at', fromTs)
      .lt('appointment_at', toExclusive)
      .order('appointment_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`detailByPlan query failed: ${error.message}`)
    const page = (data ?? []) as unknown as DetailRow[]
    raw.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  // Filtra ativos antes de decifrar nomes (evita decrypt desnecessário).
  const active = raw.filter((r) => r.effective_status === 'ativo')

  const planName = active[0]?.health_plans?.name ?? raw[0]?.health_plans?.name ?? null
  const planFallback = await ensurePlanName(supabase, input.tenantId, input.planId, planName)

  const namesMap = await decryptPatientNames(
    supabase,
    input.tenantId,
    Array.from(new Set(active.map((r) => r.patient_id))),
    key,
  )

  const procedures: PlanProcedureRow[] = active.map((r) => ({
    appointmentId: r.id,
    appointmentAt: r.appointment_at,
    patientId: r.patient_id,
    patientName: namesMap.get(r.patient_id) ?? '—',
    procedureId: r.procedure_id,
    tussCode: r.procedures?.tuss_code ?? '',
    procedureName:
      r.procedures?.display_name ?? r.procedures?.tuss_code ?? 'Sem nome',
    doctorId: r.doctor_id,
    doctorName: r.doctors?.full_name ?? '—',
    amountCents: r.net_amount_cents ?? 0,
    status: 'ativo',
  }))

  const procedureCount = procedures.length
  const totalRevenueCents = procedures.reduce((acc, p) => acc + p.amountCents, 0)

  // Top doctor + top procedure por contagem
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

  return {
    plan: { id: input.planId, name: planFallback },
    period: { from: input.from, to: input.to },
    procedures,
    totals: { procedureCount, totalRevenueCents },
    topDoctor,
    topProcedure,
  }
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
  fromAppointments: string | null,
): Promise<string> {
  if (fromAppointments) return fromAppointments
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
