import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getPatient, type PatientDetail } from '@/lib/core/patients/get'
import { listAllergies, type PatientAllergyDTO } from './allergies'
import { listHistory, type PatientHistoryDTO } from './history'
import { listVitalSigns, type VitalSignsDTO } from './vital-signs'
import { listClinicalRecords } from '@/lib/core/clinical-records/list'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'
import { listTreatmentSteps, type TreatmentStep } from '@/lib/core/treatment-steps/list'

export interface ProntuarioAppointmentRow {
  id: string
  appointmentAt: string
  netAmountCents: number | null
  effectiveStatus: string | null
  procedureName: string | null
  tussCode: string | null
  doctorName: string | null
  planName: string | null
}

export interface ProntuarioCidEntry {
  code: string
  description: string
  latestAt: string
  count: number
}

export interface ProntuarioBundle {
  tenantName: string
  generatedAt: string
  period: { from: string | null; to: string | null }
  patient: PatientDetail
  allergies: PatientAllergyDTO[]
  history: PatientHistoryDTO[]
  vitalSigns: VitalSignsDTO[]
  diagnostics: ProntuarioCidEntry[]
  evolutions: ClinicalRecordRow[]
  anamneses: ClinicalRecordRow[]
  treatmentSteps: TreatmentStep[]
  appointments: ProntuarioAppointmentRow[]
}

interface AssemblePatientChartInput {
  tenantId: string
  patientId: string
  /** YYYY-MM-DD inclusivo. */
  from?: string
  /** YYYY-MM-DD inclusivo. */
  to?: string
}

/**
 * Reúne TODAS as seções do prontuário do paciente em uma única chamada.
 * Filtros de data se aplicam a evoluções, anamneses, sinais vitais,
 * etapas de tratamento e atendimentos. Alergias e antecedentes ignoram
 * a janela temporal (são sempre relevantes pra contexto clínico atual).
 */
export async function assemblePatientChart(
  supabase: SupabaseClient<Database>,
  input: AssemblePatientChartInput,
): Promise<ProntuarioBundle> {
  const detail = await getPatient(supabase, {
    tenantId: input.tenantId,
    patientId: input.patientId,
  })

  const [allergies, history, vitalSignsAll, records, steps, appointments, tenantRow] =
    await Promise.all([
      listAllergies(supabase, { tenantId: input.tenantId, patientId: input.patientId }),
      listHistory(supabase, { tenantId: input.tenantId, patientId: input.patientId }),
      listVitalSigns(supabase, {
        tenantId: input.tenantId,
        patientId: input.patientId,
        limit: 200,
      }),
      listClinicalRecords(supabase, {
        tenantId: input.tenantId,
        patientId: input.patientId,
      }),
      listTreatmentSteps(supabase, {
        tenantId: input.tenantId,
        patientId: input.patientId,
      }),
      fetchAppointments(supabase, input.tenantId, input.patientId),
      fetchTenant(supabase, input.tenantId),
    ])

  const fromIso = input.from ? `${input.from}T00:00:00Z` : null
  const toExclusive = input.to ? nextDayIso(input.to) : null

  const inWindow = (iso: string): boolean => {
    if (fromIso && iso < fromIso) return false
    if (toExclusive && iso >= toExclusive) return false
    return true
  }

  const evolutions = records.filter(
    (r) => r.type === 'evolucao' && r.soapData && inWindow(r.createdAt),
  )
  const anamneses = records.filter(
    (r) => r.type === 'anamnese' && r.anamnesisData && inWindow(r.createdAt),
  )
  const filteredVitals = vitalSignsAll.filter((v) => inWindow(v.measuredAt))
  const filteredSteps = steps.filter((s) => inWindow(s.createdAt))
  const filteredAppointments = appointments.filter((a) =>
    inWindow(a.appointmentAt),
  )

  // Diagnósticos: dedupe por code, baseado APENAS nas evoluções da janela.
  const cidMap = new Map<string, ProntuarioCidEntry>()
  for (const r of evolutions) {
    for (const c of r.soapData?.assessment_cids ?? []) {
      const existing = cidMap.get(c.code)
      if (!existing) {
        cidMap.set(c.code, {
          code: c.code,
          description: c.description,
          latestAt: r.createdAt,
          count: 1,
        })
      } else {
        existing.count += 1
        if (r.createdAt > existing.latestAt) existing.latestAt = r.createdAt
      }
    }
  }
  const diagnostics = Array.from(cidMap.values()).sort((a, b) =>
    a.latestAt > b.latestAt ? -1 : 1,
  )

  return {
    tenantName: tenantRow?.name ?? 'Pronttu',
    generatedAt: new Date().toISOString(),
    period: { from: input.from ?? null, to: input.to ?? null },
    patient: detail.patient,
    allergies,
    history,
    vitalSigns: filteredVitals,
    diagnostics,
    evolutions,
    anamneses,
    treatmentSteps: filteredSteps,
    appointments: filteredAppointments,
  }
}

async function fetchAppointments(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<ProntuarioAppointmentRow[]> {
  const { data, error } = await supabase
    .from('appointments_effective')
    .select(
      'id, appointment_at, net_amount_cents, effective_status, ' +
        'procedures:procedure_id(tuss_code, display_name), ' +
        'doctors:doctor_id(full_name), ' +
        'health_plans:plan_id(name)',
    )
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .order('appointment_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`prontuario appointments: ${error.message}`)
  type Row = {
    id: string
    appointment_at: string
    net_amount_cents: number | null
    effective_status: string | null
    procedures: { tuss_code: string; display_name: string | null } | null
    doctors: { full_name: string } | null
    health_plans: { name: string } | null
  }
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    appointmentAt: r.appointment_at,
    netAmountCents: r.net_amount_cents,
    effectiveStatus: r.effective_status,
    procedureName: r.procedures?.display_name ?? r.procedures?.tuss_code ?? null,
    tussCode: r.procedures?.tuss_code ?? null,
    doctorName: r.doctors?.full_name ?? null,
    planName: r.health_plans?.name ?? null,
  }))
}

async function fetchTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ name: string } | null> {
  const { data } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle()
  return data ?? null
}

function nextDayIso(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}
