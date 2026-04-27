import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

export interface VitalSignsDTO {
  id: string
  patientId: string
  appointmentId: string | null
  measuredAt: string
  systolicBp: number | null
  diastolicBp: number | null
  heartRate: number | null
  respiratoryRate: number | null
  temperatureCelsius: number | null
  oxygenSaturation: number | null
  weightGrams: number | null
  heightCm: number | null
  bmi: number | null
  notes: string | null
  measuredBy: string
  createdAt: string
}

interface DbRow {
  id: string
  tenant_id: string
  patient_id: string
  appointment_id: string | null
  measured_at: string
  systolic_bp: number | null
  diastolic_bp: number | null
  heart_rate: number | null
  respiratory_rate: number | null
  temperature_celsius: number | null
  oxygen_saturation: number | null
  weight_grams: number | null
  height_cm: number | null
  bmi: number | null
  notes: string | null
  measured_by: string
  created_at: string
}

export async function listVitalSigns(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; limit?: number },
): Promise<VitalSignsDTO[]> {
  const { data, error } = await supabase
    .from('vital_signs')
    .select(
      'id, tenant_id, patient_id, appointment_id, measured_at, ' +
        'systolic_bp, diastolic_bp, heart_rate, respiratory_rate, ' +
        'temperature_celsius, oxygen_saturation, weight_grams, height_cm, bmi, ' +
        'notes, measured_by, created_at',
    )
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('measured_at', { ascending: false })
    .limit(args.limit ?? 100)
  if (error) throw new Error(`listVitalSigns failed: ${error.message}`)
  return ((data ?? []) as unknown as DbRow[]).map(toDto)
}

export interface CreateVitalSignsInput {
  tenantId: string
  patientId: string
  appointmentId?: string | null
  measuredAt?: string
  systolicBp?: number | null
  diastolicBp?: number | null
  heartRate?: number | null
  respiratoryRate?: number | null
  temperatureCelsius?: number | null
  oxygenSaturation?: number | null
  weightGrams?: number | null
  heightCm?: number | null
  notes?: string | null
  actorUserId: string
}

export async function createVitalSigns(
  supabase: SupabaseClient<Database>,
  input: CreateVitalSignsInput,
): Promise<VitalSignsDTO> {
  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  const { data, error } = await supabase
    .from('vital_signs')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      appointment_id: input.appointmentId ?? null,
      measured_at: input.measuredAt ?? new Date().toISOString(),
      systolic_bp: input.systolicBp ?? null,
      diastolic_bp: input.diastolicBp ?? null,
      heart_rate: input.heartRate ?? null,
      respiratory_rate: input.respiratoryRate ?? null,
      temperature_celsius: input.temperatureCelsius ?? null,
      oxygen_saturation: input.oxygenSaturation ?? null,
      weight_grams: input.weightGrams ?? null,
      height_cm: input.heightCm ?? null,
      notes: input.notes?.trim() || null,
      measured_by: input.actorUserId,
    })
    .select(
      'id, tenant_id, patient_id, appointment_id, measured_at, systolic_bp, diastolic_bp, heart_rate, respiratory_rate, temperature_celsius, oxygen_saturation, weight_grams, height_cm, bmi, notes, measured_by, created_at',
    )
    .single()
  if (error || !data) throw new Error(`createVitalSigns failed: ${error?.message}`)
  return toDto(data as DbRow)
}

function toDto(r: DbRow): VitalSignsDTO {
  return {
    id: r.id,
    patientId: r.patient_id,
    appointmentId: r.appointment_id,
    measuredAt: r.measured_at,
    systolicBp: r.systolic_bp,
    diastolicBp: r.diastolic_bp,
    heartRate: r.heart_rate,
    respiratoryRate: r.respiratory_rate,
    temperatureCelsius: r.temperature_celsius !== null ? Number(r.temperature_celsius) : null,
    oxygenSaturation: r.oxygen_saturation,
    weightGrams: r.weight_grams,
    heightCm: r.height_cm,
    bmi: r.bmi !== null ? Number(r.bmi) : null,
    notes: r.notes,
    measuredBy: r.measured_by,
    createdAt: r.created_at,
  }
}
