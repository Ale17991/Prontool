import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { listVitalSigns } from '@/lib/core/patient-medical/vital-signs'
import { listMeasurements, type MeasurementDTO } from './measurements'
import { listEnabledMetricTypesForTenant, type PatientMetricType } from './metric-types'
import { listCareNotes, type CareNote } from './care-notes'
import { listGoals, type PatientGoal } from './goals'
import { getActiveWorkoutPlan, type WorkoutPlan } from './workout'
import { getPortalDietPlan, type PortalDietPlan } from './diet'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { isLabAnalyte } from '@/lib/core/labs/catalog'
import {
  classifyLabResults,
  type LabResultInput,
  type LabResultItem,
} from '@/lib/core/labs/classify'
import { listLabRangesForPatient } from '@/lib/core/labs/reference-ranges'

/**
 * Feature 030 — bundle de leitura do portal do paciente (FR-006..FR-010).
 *
 * INVARIANTE DE SEGURANÇA: `tenantId`/`patientId` vêm EXCLUSIVAMENTE da
 * sessão verificada (cookie HMAC) — nunca do cliente. Toda query filtra
 * por ambos. Nenhum dado financeiro sai daqui (FR-009); do paciente, só o
 * primeiro nome (minimização LGPD).
 */

export interface WeightImcPoint {
  /** Data da medição (ISO). */
  measuredAt: string
  weightKg: number | null
  bmi: number | null
}

export interface PortalAppointment {
  id: string
  /** Data/hora do atendimento (ISO). */
  appointmentAt: string
  doctorName: string | null
  procedureName: string | null
  status: string | null
}

export interface PatientPortalBundle {
  patient: { firstName: string }
  weightImc: WeightImcPoint[]
  /** Séries por métrica (ordem cronológica asc), só métricas com dados ou do catálogo ativo. */
  metrics: Record<string, MeasurementDTO[]>
  metricTypes: PatientMetricType[]
  appointments: PortalAppointment[]
  /** Orientações escritas pelo profissional (seção `orientacoes`). */
  careNotes: CareNote[]
  /** Metas ativas por métrica (seção `metas`). */
  goals: PatientGoal[]
  /** Plano de treino ativo (seção `treino`), ou null. */
  workout: WorkoutPlan | null
  /** Plano alimentar entregue (prescrição 047 ou plano legado 032), ou null. */
  diet: PortalDietPlan | null
  /**
   * Exames laboratoriais recentes já classificados (seção `exames`, 050), ou
   * null quando o módulo está off ou falta sexo/idade para aplicar a faixa.
   */
  labResults: LabResultItem[] | null
}

export async function buildPatientPortalBundle(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<PatientPortalBundle> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required for the patient portal')

  const [
    identity,
    vitals,
    metricsRaw,
    metricTypesRaw,
    appointments,
    careNotes,
    goals,
    workout,
    diet,
    ent,
  ] = await Promise.all([
    resolvePatientIdentity(supabase, args, key),
    listVitalSigns(supabase, { tenantId: args.tenantId, patientId: args.patientId }),
    listMeasurements(supabase, { tenantId: args.tenantId, patientId: args.patientId }),
    listEnabledMetricTypesForTenant(supabase, args.tenantId, { specialty: 'endocrino' }),
    listPortalAppointments(supabase, args),
    listCareNotes(supabase, args.tenantId, args.patientId),
    listGoals(supabase, args.tenantId, args.patientId),
    getActiveWorkoutPlan(supabase, args.tenantId, args.patientId),
    getPortalDietPlan(supabase, args.tenantId, args.patientId),
    getTenantEntitlements(supabase, args.tenantId),
  ])

  // Módulo Endócrino off ⇒ esconde as métricas metabólicas (peso/IMC seguem,
  // pois vêm de vital_signs e não são endócrino-específicos).
  const showEndocrino = ent.hasModule('endocrino')
  const metrics = showEndocrino ? metricsRaw : {}
  const metricTypes = showEndocrino ? metricTypesRaw : []

  // Peso/IMC: reusa vital_signs (FR-007), ordem cronológica ascendente,
  // só pontos com peso ou IMC.
  const weightImc: WeightImcPoint[] = vitals
    .filter((v) => v.weightGrams !== null || v.bmi !== null)
    .map((v) => ({
      measuredAt: v.measuredAt,
      weightKg: v.weightGrams !== null ? v.weightGrams / 1000 : null,
      bmi: v.bmi,
    }))
    .reverse()

  // Feature 050 US3 — exames laboratoriais no portal. Só com o módulo; sem sexo
  // ou idade no cadastro não há faixa aplicável, então nada é exibido (o
  // paciente não deve ver valor cru sem interpretação).
  let labResults: LabResultItem[] | null = null
  if (ent.hasModule('exames_lab') && identity.sex && identity.ageYears !== null) {
    const inputs: LabResultInput[] = []
    for (const [metricType, list] of Object.entries(metricsRaw)) {
      if (!isLabAnalyte(metricType)) continue
      for (const m of list) {
        inputs.push({
          analyteKey: metricType,
          value: m.value,
          unit: m.unit,
          measuredAt: m.measuredAt,
        })
      }
    }
    if (inputs.length > 0) {
      const ranges = await listLabRangesForPatient(supabase, {
        ageYears: identity.ageYears,
        sex: identity.sex,
      })
      labResults = classifyLabResults(inputs, ranges).items
    }
  }

  return {
    patient: { firstName: identity.firstName },
    weightImc,
    metrics,
    metricTypes,
    appointments,
    careNotes,
    goals,
    workout,
    diet,
    labResults,
  }
}

/**
 * Resolve APENAS o primeiro nome do paciente para a saudação do portal
 * (minimização LGPD — o portal não precisa da PII completa). É tolerante a
 * falha: `get_patient_for_tenant` decifra ~22 colunas, e se QUALQUER uma
 * estiver corrompida ou cifrada com chave antiga (comum em dados legados/GHL)
 * a função inteira lança "Wrong key or corrupt data". Nesse caso o portal
 * degrada para saudação sem nome em vez de quebrar a página inteira — o login
 * (que só decifra CPF+nascimento) já validou a identidade.
 */
async function resolvePatientIdentity(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
  key: string,
): Promise<{ firstName: string; sex: 'M' | 'F' | null; ageYears: number | null }> {
  const empty = { firstName: '', sex: null, ageYears: null }
  try {
    const { data, error } = await supabase.rpc('get_patient_for_tenant', {
      p_tenant_id: args.tenantId,
      p_patient_id: args.patientId,
      p_key: key,
    } as never)
    if (error) return empty
    const patient = ((data as unknown as Array<{
      full_name: string | null
      sex: string | null
      birth_date: string | null
    }>) ?? [])[0]
    if (!patient) return empty
    return {
      firstName: (patient.full_name ?? '').trim().split(/\s+/)[0] ?? '',
      sex: patient.sex === 'masculino' ? 'M' : patient.sex === 'feminino' ? 'F' : null,
      ageYears: patient.birth_date ? ageFromBirth(patient.birth_date) : null,
    }
  } catch {
    return empty
  }
}

function ageFromBirth(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a >= 0 && a < 130 ? a : null
}

/**
 * Histórico de atendimentos do paciente (US3/FR-009): data, profissional e
 * tipo — SEM nenhum campo financeiro. Usa a view `appointments_effective`
 * (exclui estornados) e omite cancelados.
 */
async function listPortalAppointments(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<PortalAppointment[]> {
  const { data, error } = await supabase
    .from('appointments_effective')
    .select('id, appointment_at, doctor_id, procedure_id, effective_status')
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('appointment_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`listPortalAppointments failed: ${error.message}`)

  const rows = (
    (data ?? []) as unknown as Array<{
      id: string | null
      appointment_at: string | null
      doctor_id: string | null
      procedure_id: string | null
      effective_status: string | null
    }>
  ).filter((r) => r.id && r.appointment_at && r.effective_status !== 'cancelado')

  const doctorIds = [...new Set(rows.map((r) => r.doctor_id).filter(Boolean))] as string[]
  const procedureIds = [...new Set(rows.map((r) => r.procedure_id).filter(Boolean))] as string[]

  const [doctorsRes, proceduresRes] = await Promise.all([
    doctorIds.length
      ? supabase
          .from('doctors')
          .select('id, full_name')
          .eq('tenant_id', args.tenantId)
          .in('id', doctorIds)
      : Promise.resolve({ data: [], error: null }),
    procedureIds.length
      ? supabase
          .from('procedures')
          .select('id, display_name')
          .eq('tenant_id', args.tenantId)
          .in('id', procedureIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const doctorName = new Map(
    ((doctorsRes.data ?? []) as Array<{ id: string; full_name: string }>).map((d) => [
      d.id,
      d.full_name,
    ]),
  )
  const procedureName = new Map(
    ((proceduresRes.data ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [
      p.id,
      p.display_name,
    ]),
  )

  return rows.map((r) => ({
    id: r.id!,
    appointmentAt: r.appointment_at!,
    doctorName: r.doctor_id ? (doctorName.get(r.doctor_id) ?? null) : null,
    procedureName: r.procedure_id ? (procedureName.get(r.procedure_id) ?? null) : null,
    status: r.effective_status,
  }))
}
