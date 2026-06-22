import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import {
  getTenantTimezone,
  ymdStartOfDayUtc,
  ymdNextDayStartUtc,
} from '@/lib/utils/tenant-tz'
import {
  fetchActiveAppointments,
  fetchProcedureLines as fetchLines,
  fetchAllReportDoctors as fetchAllDoctors,
  fetchPlanTaxRates,
  validateReportPeriod as validatePeriod,
  type ActiveAppointmentRow,
  type ProcedureLineRow as LineRow,
  type ReportDoctorRow as DoctorRow,
} from './_sources'
import {
  aggregateDoctorPlanMatrix,
  type DoctorPlanBreakdown,
} from './doctor-plan-matrix'

/**
 * Agregadores para o relatorio "Por Profissional":
 *   - summaryByProfessional(period) → uma linha por profissional ATIVO com
 *     contagem de procedimentos, faturamento e comissao no periodo.
 *   - detailByProfessional(doctorId, period) → tabela linha-a-linha de
 *     procedimentos realizados pelo profissional, com paciente decifrado.
 *
 * Fontes:
 *   - appointments_effective (para filtrar estornos via effective_status='ativo')
 *   - appointment_procedures (linhas com valor e plano por linha — migration 0069)
 *   - appointments.frozen_commission_bps (snapshot historico de comissao no
 *     momento do atendimento — Constitution gate I/Imutabilidade)
 *
 * Comissao calculada por linha:
 *   commission_cents = floor(line_amount_cents * frozen_commission_bps / 10000)
 *
 * O percentual e congelado no momento do atendimento (frozen_commission_bps).
 * Se a comissao do profissional mudar no futuro, atendimentos passados nao
 * sao re-calculados.
 */

export interface ProfessionalSummaryRow {
  doctorId: string
  doctorName: string
  role: string | null
  specialty: string | null
  procedureCount: number
  totalRevenueCents: number
  totalCommissionCents: number
  /** Honorários de participação (equipe/instrumentação) no período. */
  totalParticipationCents: number
  /** Imposto do convênio (tax_rate_bps) somado sobre a receita do médico. */
  totalTaxFromPlanCents: number
  /** Receita líquida do médico após o imposto do convênio. */
  totalNetOfTaxCents: number
  /** Quebra da receita/comissão deste médico por convênio. */
  byPlan: DoctorPlanBreakdown[]
}

export interface ProfessionalParticipationRow {
  appointmentId: string
  appointmentAt: string
  procedureName: string
  tussCode: string
  participationDegree: string | null
  amountCents: number
}

export interface ProfessionalProcedureRow {
  appointmentId: string
  appointmentAt: string
  patientId: string
  patientName: string
  procedureId: string
  tussCode: string
  procedureName: string
  planId: string | null
  planName: string
  /** Valor UNITARIO em cents. */
  unitAmountCents: number
  /** Quantidade da linha (>=1, default 1). Migration 0081. */
  quantity: number
  /** Total da linha = unitAmountCents * quantity. */
  amountCents: number
  commissionBps: number
  /** Commissao calculada sobre o TOTAL da linha. */
  commissionCents: number
  status: 'ativo'
}

export interface ProfessionalDetail {
  doctor: {
    id: string
    fullName: string
    role: string | null
    specialty: string | null
    councilName: string | null
    councilNumber: string | null
    crm: string | null
  }
  period: { from: string; to: string }
  procedures: ProfessionalProcedureRow[]
  totals: {
    procedureCount: number
    totalRevenueCents: number
    totalCommissionCents: number
    /** Honorários de participação no período. */
    totalParticipationCents: number
    /** Imposto do convênio somado sobre a receita do médico. */
    totalTaxFromPlanCents: number
    /** Receita líquida após o imposto do convênio. */
    totalNetOfTaxCents: number
  }
  /** Subtotais por convênio dentro deste profissional. */
  byPlan: DoctorPlanBreakdown[]
  /** Honorários de participação (equipe/instrumentação) do profissional. */
  participations: ProfessionalParticipationRow[]
  topProcedure: {
    procedureId: string
    procedureName: string
    tussCode: string
    count: number
  } | null
}

interface DecryptedNameRow {
  id: string
  full_name: string | null
  anonymized_at: string | null
}

interface RawParticipation {
  doctorId: string
  appointmentId: string
  appointmentAt: string
  procedureName: string
  tussCode: string
  participationDegree: string | null
  amountCents: number
}

/**
 * Honorários de participação (appointment_assistants) no período [from, to],
 * excluindo participações removidas e atendimentos estornados. Inclui nome do
 * procedimento e grau de participação. Best-effort (retorna [] se a tabela não
 * existir no ambiente).
 */
async function fetchParticipations(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  from: string,
  to: string,
): Promise<RawParticipation[]> {
  const { data, error } = await supabase
    .from('appointment_assistants' as never)
    .select(
      'assistant_doctor_id, frozen_amount_cents, participation_degree, appointment_id, ' +
        'appointment:appointment_id ( appointment_at ), procedures:procedure_id ( tuss_code, display_name )',
    )
    .eq('tenant_id', tenantId)
    .is('removed_at', null)
  if (error) return []
  const rows = (data ?? []) as unknown as Array<{
    assistant_doctor_id: string
    frozen_amount_cents: number
    participation_degree: string | null
    appointment_id: string
    appointment: { appointment_at: string | null } | null
    procedures: { tuss_code: string | null; display_name: string | null } | null
  }>
  const fromMs = new Date(`${from}T00:00:00`).getTime()
  const toExclusiveMs = new Date(`${to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000
  const inRange = rows.filter((r) => {
    const at = r.appointment?.appointment_at
    if (!at) return false
    const t = new Date(at).getTime()
    return t >= fromMs && t < toExclusiveMs
  })
  if (inRange.length === 0) return []

  const apptIds = Array.from(new Set(inRange.map((r) => r.appointment_id)))
  const { data: reversalsRaw } = await supabase
    .from('appointment_reversals')
    .select('appointment_id')
    .in('appointment_id', apptIds)
  const reversed = new Set(
    ((reversalsRaw ?? []) as Array<{ appointment_id: string }>).map((r) => r.appointment_id),
  )

  return inRange
    .filter((r) => !reversed.has(r.appointment_id))
    .map((r) => ({
      doctorId: r.assistant_doctor_id,
      appointmentId: r.appointment_id,
      appointmentAt: r.appointment?.appointment_at ?? '',
      procedureName: r.procedures?.display_name ?? r.procedures?.tuss_code ?? 'Procedimento',
      tussCode: r.procedures?.tuss_code ?? '',
      participationDegree: r.participation_degree,
      amountCents: Number(r.frozen_amount_cents ?? 0),
    }))
}

export async function summaryByProfessional(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; from: string; to: string },
): Promise<ProfessionalSummaryRow[]> {
  validatePeriod(input.from, input.to)

  // Camada 3 T1 — boundaries no fuso do tenant.
  const tz = await getTenantTimezone(supabase, input.tenantId)
  const fromTs = ymdStartOfDayUtc(input.from, tz)
  const toExclusive = ymdNextDayStartUtc(input.to, tz)

  const [active, allDoctors, participations] = await Promise.all([
    fetchActiveAppointments(supabase, input.tenantId, fromTs, toExclusive),
    fetchAllDoctors(supabase, input.tenantId),
    fetchParticipations(supabase, input.tenantId, input.from, input.to),
  ])
  const partByDoctor = new Map<string, number>()
  for (const p of participations) {
    partByDoctor.set(p.doctorId, (partByDoctor.get(p.doctorId) ?? 0) + p.amountCents)
  }
  if (active.length === 0) {
    return enrichAllDoctorsWithZero(allDoctors, partByDoctor)
  }

  const lines = await fetchLines(
    supabase,
    input.tenantId,
    active.map((a) => a.id),
  )

  const planIds = Array.from(
    new Set(
      lines
        .map((l) => l.plan_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const planTaxMap = await fetchPlanTaxRates(supabase, input.tenantId, planIds)

  // Reusa a matriz médico×plano: a soma por médico é idêntica ao agregado
  // anterior (mesmo frozen_commission_bps, mesmo Math.round), mas agora
  // carrega imposto do convênio, líquido e a quebra por plano.
  const doctorNameById = new Map(allDoctors.map((d) => [d.id, d.full_name]))
  const matrix = aggregateDoctorPlanMatrix({
    appointments: active,
    lines,
    doctorNameById,
    planTaxMap,
  })
  const rollupById = new Map(matrix.byDoctor.map((r) => [r.doctorId, r]))

  const out: ProfessionalSummaryRow[] = allDoctors.map((d) => {
    const agg = rollupById.get(d.id)
    return {
      doctorId: d.id,
      doctorName: d.full_name,
      role: d.role,
      specialty: d.specialty,
      procedureCount: agg?.procedureCount ?? 0,
      totalRevenueCents: agg?.grossCents ?? 0,
      totalCommissionCents: agg?.commissionCents ?? 0,
      totalParticipationCents: partByDoctor.get(d.id) ?? 0,
      totalTaxFromPlanCents: agg?.taxFromPlanCents ?? 0,
      totalNetOfTaxCents: agg?.netOfTaxCents ?? 0,
      byPlan: agg?.byPlan ?? [],
    }
  })
  // Profissionais com mais faturamento primeiro; empate ordena por nome.
  return out.sort((a, b) => {
    if (b.totalRevenueCents !== a.totalRevenueCents) {
      return b.totalRevenueCents - a.totalRevenueCents
    }
    return a.doctorName.localeCompare(b.doctorName, 'pt-BR')
  })
}

export async function detailByProfessional(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; doctorId: string; from: string; to: string },
): Promise<ProfessionalDetail> {
  validatePeriod(input.from, input.to)

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to decrypt patient names')
  }

  // Camada 3 T1 — boundaries no fuso do tenant.
  const tz = await getTenantTimezone(supabase, input.tenantId)
  const fromTs = ymdStartOfDayUtc(input.from, tz)
  const toExclusive = ymdNextDayStartUtc(input.to, tz)

  const doctor = await fetchDoctorById(supabase, input.tenantId, input.doctorId)

  // Honorários de participação deste profissional (independe de ser executante).
  const allParticipations = await fetchParticipations(
    supabase,
    input.tenantId,
    input.from,
    input.to,
  )
  const participations: ProfessionalParticipationRow[] = allParticipations
    .filter((p) => p.doctorId === input.doctorId)
    .map((p) => ({
      appointmentId: p.appointmentId,
      appointmentAt: p.appointmentAt,
      procedureName: p.procedureName,
      tussCode: p.tussCode,
      participationDegree: p.participationDegree,
      amountCents: p.amountCents,
    }))
    .sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt))
  const totalParticipationCents = participations.reduce((s, p) => s + p.amountCents, 0)

  const active = await fetchActiveAppointments(
    supabase,
    input.tenantId,
    fromTs,
    toExclusive,
  )
  const ownAppointments = active.filter((a) => a.doctor_id === input.doctorId)
  if (ownAppointments.length === 0) {
    return {
      doctor: mapDoctor(doctor),
      period: { from: input.from, to: input.to },
      procedures: [],
      totals: {
        procedureCount: 0,
        totalRevenueCents: 0,
        totalCommissionCents: 0,
        totalParticipationCents,
        totalTaxFromPlanCents: 0,
        totalNetOfTaxCents: 0,
      },
      byPlan: [],
      participations,
      topProcedure: null,
    }
  }

  const appointmentById = new Map<string, ActiveAppointmentRow>()
  for (const a of ownAppointments) appointmentById.set(a.id, a)

  const lines = await fetchLines(
    supabase,
    input.tenantId,
    ownAppointments.map((a) => a.id),
  )

  const patientIds = Array.from(
    new Set(
      lines
        .map((l) => appointmentById.get(l.appointment_id)?.patient_id)
        .filter((v): v is string => typeof v === 'string'),
    ),
  )
  const namesMap = await decryptPatientNames(supabase, input.tenantId, patientIds, key)

  const procedures: ProfessionalProcedureRow[] = lines.map((l) => {
    const a = appointmentById.get(l.appointment_id)!
    const bps = a.frozen_commission_bps
    const qty = l.quantity || 1
    const lineTotal = l.line_amount_cents * qty
    // Camada 3 T2 — Math.round padronizado (ver summary acima).
    const commissionCents = Math.round((lineTotal * bps) / 10000)
    return {
      appointmentId: l.appointment_id,
      appointmentAt: a.appointment_at,
      patientId: a.patient_id,
      patientName: namesMap.get(a.patient_id) ?? '—',
      procedureId: l.procedure_id,
      tussCode: l.procedures?.tuss_code ?? '',
      procedureName: l.procedures?.display_name ?? l.procedures?.tuss_code ?? 'Sem nome',
      planId: l.plan_id,
      planName: l.health_plans?.name ?? 'Particular',
      unitAmountCents: l.line_amount_cents,
      quantity: qty,
      amountCents: lineTotal,
      commissionBps: bps,
      commissionCents,
      status: 'ativo' as const,
    }
  })

  procedures.sort((a, b) => {
    if (a.appointmentAt < b.appointmentAt) return -1
    if (a.appointmentAt > b.appointmentAt) return 1
    if (a.appointmentId < b.appointmentId) return -1
    if (a.appointmentId > b.appointmentId) return 1
    return 0
  })

  // procedureCount = soma de quantities (qty=3 vale por 3 procedimentos).
  const procedureCount = procedures.reduce((acc, p) => acc + p.quantity, 0)
  const totalRevenueCents = procedures.reduce((acc, p) => acc + p.amountCents, 0)
  const totalCommissionCents = procedures.reduce((acc, p) => acc + p.commissionCents, 0)

  const procedureCounts = new Map<
    string,
    { procedureId: string; procedureName: string; tussCode: string; count: number }
  >()
  for (const row of procedures) {
    const existing = procedureCounts.get(row.procedureId) ?? {
      procedureId: row.procedureId,
      procedureName: row.procedureName,
      tussCode: row.tussCode,
      count: 0,
    }
    existing.count += row.quantity
    procedureCounts.set(row.procedureId, existing)
  }
  const topProcedure =
    Array.from(procedureCounts.values()).sort((a, b) => b.count - a.count)[0] ?? null

  // Quebra por convênio + imposto do plano, via a mesma matriz médico×plano
  // (garante que os subtotais somem exatamente o totalCommission acima).
  const planIds = Array.from(
    new Set(
      lines
        .map((l) => l.plan_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const planTaxMap = await fetchPlanTaxRates(supabase, input.tenantId, planIds)
  const matrix = aggregateDoctorPlanMatrix({
    appointments: ownAppointments,
    lines,
    doctorNameById: new Map([[doctor.id, doctor.full_name]]),
    planTaxMap,
  })
  const rollup = matrix.byDoctor[0]
  const byPlan = rollup?.byPlan ?? []
  const totalTaxFromPlanCents = rollup?.taxFromPlanCents ?? 0
  const totalNetOfTaxCents = rollup?.netOfTaxCents ?? totalRevenueCents

  return {
    doctor: mapDoctor(doctor),
    period: { from: input.from, to: input.to },
    procedures,
    totals: {
      procedureCount,
      totalRevenueCents,
      totalCommissionCents,
      totalParticipationCents,
      totalTaxFromPlanCents,
      totalNetOfTaxCents,
    },
    byPlan,
    participations,
    topProcedure,
  }
}

function mapDoctor(d: DoctorRow): ProfessionalDetail['doctor'] {
  return {
    id: d.id,
    fullName: d.full_name,
    role: d.role,
    specialty: d.specialty,
    councilName: d.council_name,
    councilNumber: d.council_number,
    crm: d.crm,
  }
}

function enrichAllDoctorsWithZero(
  doctors: DoctorRow[],
  partByDoctor?: Map<string, number>,
): ProfessionalSummaryRow[] {
  return doctors
    .map((d) => ({
      doctorId: d.id,
      doctorName: d.full_name,
      role: d.role,
      specialty: d.specialty,
      procedureCount: 0,
      totalRevenueCents: 0,
      totalCommissionCents: 0,
      totalParticipationCents: partByDoctor?.get(d.id) ?? 0,
      totalTaxFromPlanCents: 0,
      totalNetOfTaxCents: 0,
      byPlan: [],
    }))
    .sort((a, b) => a.doctorName.localeCompare(b.doctorName, 'pt-BR'))
}

async function fetchDoctorById(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  doctorId: string,
): Promise<DoctorRow> {
  const { data, error } = await supabase
    .from('doctors')
    .select('id, full_name, role, specialty, council_name, council_number, crm, active')
    .eq('tenant_id', tenantId)
    .eq('id', doctorId)
    .maybeSingle()
  if (error) throw new Error(`fetchDoctorById failed: ${error.message}`)
  if (!data) {
    throw new ValidationError(`Profissional ${doctorId} não encontrado`)
  }
  return data as unknown as DoctorRow
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


