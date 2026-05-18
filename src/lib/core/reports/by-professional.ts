import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import {
  getTenantTimezone,
  ymdStartOfDayUtc,
  ymdNextDayStartUtc,
} from '@/lib/utils/tenant-tz'

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

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export interface ProfessionalSummaryRow {
  doctorId: string
  doctorName: string
  role: string | null
  specialty: string | null
  procedureCount: number
  totalRevenueCents: number
  totalCommissionCents: number
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
  }
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
  frozen_commission_bps: number
}

interface LineRow {
  appointment_id: string
  procedure_id: string
  plan_id: string | null
  /** UNITARIO em cents. */
  line_amount_cents: number
  /** Multiplicador (default 1). Migration 0081. */
  quantity: number
  procedures: { id: string; tuss_code: string; display_name: string | null } | null
  health_plans: { id: string; name: string } | null
}

interface DoctorRow {
  id: string
  full_name: string
  role: string | null
  specialty: string | null
  council_name: string | null
  council_number: string | null
  crm: string | null
  active: boolean
}

interface DecryptedNameRow {
  id: string
  full_name: string | null
  anonymized_at: string | null
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

  const active = await fetchActiveAppointments(
    supabase,
    input.tenantId,
    fromTs,
    toExclusive,
  )
  if (active.length === 0) {
    return enrichAllDoctorsWithZero(await fetchAllDoctors(supabase, input.tenantId))
  }

  const appointmentById = new Map<string, ActiveAppointmentRow>()
  for (const a of active) appointmentById.set(a.id, a)

  const lines = await fetchLines(
    supabase,
    input.tenantId,
    active.map((a) => a.id),
  )

  // Agrega por doctor_id usando frozen_commission_bps do atendimento.
  type RawRow = {
    doctorId: string
    procedureCount: number
    totalRevenueCents: number
    totalCommissionCents: number
  }
  const map = new Map<string, RawRow>()
  for (const l of lines) {
    const a = appointmentById.get(l.appointment_id)
    if (!a) continue
    const doctorId = a.doctor_id
    const qty = l.quantity || 1
    const lineTotal = l.line_amount_cents * qty
    const existing = map.get(doctorId) ?? {
      doctorId,
      procedureCount: 0,
      totalRevenueCents: 0,
      totalCommissionCents: 0,
    }
    existing.procedureCount += qty
    existing.totalRevenueCents += lineTotal
    existing.totalCommissionCents += Math.floor(
      (lineTotal * a.frozen_commission_bps) / 10000,
    )
    map.set(doctorId, existing)
  }

  const allDoctors = await fetchAllDoctors(supabase, input.tenantId)
  const out: ProfessionalSummaryRow[] = allDoctors.map((d) => {
    const agg = map.get(d.id)
    return {
      doctorId: d.id,
      doctorName: d.full_name,
      role: d.role,
      specialty: d.specialty,
      procedureCount: agg?.procedureCount ?? 0,
      totalRevenueCents: agg?.totalRevenueCents ?? 0,
      totalCommissionCents: agg?.totalCommissionCents ?? 0,
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
      },
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
    const commissionCents = Math.floor((lineTotal * bps) / 10000)
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

  return {
    doctor: mapDoctor(doctor),
    period: { from: input.from, to: input.to },
    procedures,
    totals: {
      procedureCount,
      totalRevenueCents,
      totalCommissionCents,
    },
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

function enrichAllDoctorsWithZero(doctors: DoctorRow[]): ProfessionalSummaryRow[] {
  return doctors
    .map((d) => ({
      doctorId: d.id,
      doctorName: d.full_name,
      role: d.role,
      specialty: d.specialty,
      procedureCount: 0,
      totalRevenueCents: 0,
      totalCommissionCents: 0,
    }))
    .sort((a, b) => a.doctorName.localeCompare(b.doctorName, 'pt-BR'))
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
        'id, patient_id, doctor_id, appointment_at, effective_status, frozen_commission_bps',
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
          'appointment_id, procedure_id, plan_id, line_amount_cents, quantity, ' +
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

async function fetchAllDoctors(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<DoctorRow[]> {
  const { data, error } = await supabase
    .from('doctors')
    .select('id, full_name, role, specialty, council_name, council_number, crm, active')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('full_name', { ascending: true })
  if (error) throw new Error(`fetchAllDoctors failed: ${error.message}`)
  return (data ?? []) as unknown as DoctorRow[]
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

function validatePeriod(from: string, to: string): void {
  if (!DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
    throw new ValidationError('Parâmetros from/to devem estar no formato YYYY-MM-DD')
  }
  if (from > to) {
    throw new ValidationError('Parâmetro `from` não pode ser posterior a `to`')
  }
}

