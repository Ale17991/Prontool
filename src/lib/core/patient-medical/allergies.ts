import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/lib/observability/errors'

export type AllergySeverity = 'leve' | 'moderada' | 'grave'

export interface PatientAllergyDTO {
  id: string
  patientId: string
  substance: string
  severity: AllergySeverity
  notes: string | null
  reportedAt: string
  reportedBy: string
  deletedAt: string | null
}

interface DbRow {
  id: string
  tenant_id: string
  patient_id: string
  substance: string
  severity: string
  notes: string | null
  reported_at: string
  reported_by: string
  deleted_at: string | null
}

export async function listAllergies(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; includeDeleted?: boolean },
): Promise<PatientAllergyDTO[]> {
  let q = supabase
    .from('patient_allergies')
    .select('id, tenant_id, patient_id, substance, severity, notes, reported_at, reported_by, deleted_at')
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('reported_at', { ascending: false })
  if (!args.includeDeleted) q = q.is('deleted_at', null)
  const { data, error } = await q
  if (error) throw new Error(`listAllergies failed: ${error.message}`)
  return ((data ?? []) as DbRow[]).map(toDto)
}

export interface CreateAllergyInput {
  tenantId: string
  patientId: string
  substance: string
  severity: AllergySeverity
  notes?: string | null
  actorUserId: string
}

export async function createAllergy(
  supabase: SupabaseClient<Database>,
  input: CreateAllergyInput,
): Promise<PatientAllergyDTO> {
  if (input.substance.trim().length < 1) {
    throw new ValidationError('Informe a substância da alergia')
  }
  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  const { data, error } = await supabase
    .from('patient_allergies')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      substance: input.substance.trim(),
      severity: input.severity,
      notes: input.notes?.trim() || null,
      reported_by: input.actorUserId,
    })
    .select(
      'id, tenant_id, patient_id, substance, severity, notes, reported_at, reported_by, deleted_at',
    )
    .single()
  if (error || !data) throw new Error(`createAllergy failed: ${error?.message}`)
  return toDto(data as DbRow)
}

export async function softDeleteAllergy(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; allergyId: string },
): Promise<void> {
  const existing = await supabase
    .from('patient_allergies')
    .select('id, deleted_at')
    .eq('tenant_id', args.tenantId)
    .eq('id', args.allergyId)
    .maybeSingle()
  if (existing.error) throw new Error(`allergy lookup: ${existing.error.message}`)
  if (!existing.data) throw new NotFoundError('patient_allergy', args.allergyId)
  if (existing.data.deleted_at) {
    throw new ConflictError('ALLERGY_ALREADY_DELETED', 'Alergia já removida', {
      allergy_id: args.allergyId,
    })
  }
  const { error } = await supabase
    .from('patient_allergies')
    .update({ deleted_at: new Date().toISOString() })
    .eq('tenant_id', args.tenantId)
    .eq('id', args.allergyId)
  if (error) throw new Error(`softDeleteAllergy failed: ${error.message}`)
}

function toDto(r: DbRow): PatientAllergyDTO {
  return {
    id: r.id,
    patientId: r.patient_id,
    substance: r.substance,
    severity: r.severity as AllergySeverity,
    notes: r.notes,
    reportedAt: r.reported_at,
    reportedBy: r.reported_by,
    deletedAt: r.deleted_at,
  }
}
