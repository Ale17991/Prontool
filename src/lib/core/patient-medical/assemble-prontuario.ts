import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getPatient, type PatientDetail } from '@/lib/core/patients/get'
import { listAllergies, type PatientAllergyDTO } from './allergies'
import { listDiagnoses, type PatientDiagnosisDTO } from './diagnoses'
import { listHistory, type PatientHistoryDTO } from './history'
import { listVitalSigns, type VitalSignsDTO } from './vital-signs'
import { listClinicalRecords } from '@/lib/core/clinical-records/list'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'
import { listTreatmentSteps, type TreatmentStep } from '@/lib/core/treatment-steps/list'
import { listMaterialsByAppointmentIds } from '@/lib/core/appointments/materials'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import {
  CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
  type ClinicProfile,
} from '@/lib/core/clinic-profile/types'

export interface ProntuarioAppointmentRow {
  id: string
  appointmentAt: string
  netAmountCents: number | null
  effectiveStatus: string | null
  procedureName: string | null
  tussCode: string | null
  doctorName: string | null
  planName: string | null
  /** Materiais (TUSS tabela 19) utilizados neste atendimento — feature 007. */
  materials: ProntuarioMaterialRow[]
}

export interface ProntuarioMaterialRow {
  tussCode: string
  tussDescription: string
  quantity: number
}

export interface ProntuarioCidEntry {
  code: string
  description: string
  /** Data do diagnóstico (campo `diagnosed_at` em `patient_diagnoses`). */
  diagnosedAt: string
  status: 'ativo' | 'em_acompanhamento' | 'resolvido'
  additionalNotes: string | null
}

export interface ProntuarioBundle {
  tenantName: string
  /** Perfil completo da clínica (logo + dados oficiais) — feature 009. */
  clinicProfile: ClinicProfile | null
  /** URL assinada (TTL curto) da logo, pronta para `<Image src>`. */
  signedLogoUrl: string | null
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

  const [
    allergies,
    history,
    vitalSignsAll,
    records,
    steps,
    appointments,
    tenantRow,
    diagnosesAll,
    clinicProfile,
  ] = await Promise.all([
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
    listDiagnoses(supabase, {
      tenantId: input.tenantId,
      patientId: input.patientId,
    }).catch(() => [] as PatientDiagnosisDTO[]),
    getClinicProfile(supabase, input.tenantId, CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS).catch(
      () => null,
    ),
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

  // Carrega materiais em batch para os atendimentos da janela.
  if (filteredAppointments.length > 0) {
    const ids = filteredAppointments.map((a) => a.id)
    const grouped = await listMaterialsByAppointmentIds(
      supabase,
      ids,
      input.tenantId,
    )
    for (const a of filteredAppointments) {
      const rows = grouped[a.id] ?? []
      a.materials = rows.map((r) => ({
        tussCode: r.tussCode,
        tussDescription: r.tussDescription,
        quantity: r.quantity,
      }))
    }
  }

  // Diagnósticos: lê direto de `patient_diagnoses` (replicando feature
  // 0060). Filtra pela janela temporal pela data do diagnóstico.
  const diagnostics: ProntuarioCidEntry[] = diagnosesAll
    .filter((d) => {
      const iso = `${d.diagnosedAt}T00:00:00Z`
      return inWindow(iso)
    })
    .map((d) => ({
      code: d.cid10Code,
      description: d.cid10Description,
      diagnosedAt: d.diagnosedAt,
      status: d.status,
      additionalNotes: d.additionalNotes,
    }))

  return {
    tenantName: tenantRow?.name ?? 'Clinni',
    clinicProfile,
    signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
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
    materials: [],
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
