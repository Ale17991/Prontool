import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/lib/observability/errors'

export type DiagnosisStatus = 'ativo' | 'em_acompanhamento' | 'resolvido'

export interface PatientDiagnosisDTO {
  id: string
  patientId: string
  cid10Code: string
  cid10Description: string
  additionalNotes: string | null
  diagnosedAt: string
  status: DiagnosisStatus
  diagnosedBy: string
  createdAt: string
  deletedAt: string | null
}

interface DbRow {
  id: string
  tenant_id: string
  patient_id: string
  cid10_code: string
  cid10_description: string
  additional_notes: string | null
  diagnosed_at: string
  status: string
  diagnosed_by: string
  created_at: string
  deleted_at: string | null
}

const SELECT_COLUMNS =
  'id, tenant_id, patient_id, cid10_code, cid10_description, additional_notes, ' +
  'diagnosed_at, status, diagnosed_by, created_at, deleted_at'

export async function listDiagnoses(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; includeDeleted?: boolean },
): Promise<PatientDiagnosisDTO[]> {
  let q = supabase
    .from('patient_diagnoses')
    .select(SELECT_COLUMNS)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('diagnosed_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (!args.includeDeleted) q = q.is('deleted_at', null)
  const { data, error } = await q
  if (error) throw new Error(`listDiagnoses failed: ${error.message}`)
  return ((data ?? []) as unknown as DbRow[]).map(toDto)
}

export interface CreateDiagnosisInput {
  tenantId: string
  patientId: string
  cid10Code: string
  cid10Description: string
  additionalNotes?: string | null
  diagnosedAt?: string | null
  status?: DiagnosisStatus
  actorUserId: string
}

export async function createDiagnosis(
  supabase: SupabaseClient<Database>,
  input: CreateDiagnosisInput,
): Promise<PatientDiagnosisDTO> {
  const code = input.cid10Code.trim().toUpperCase()
  const description = input.cid10Description.trim()
  if (code.length < 1) throw new ValidationError('Informe o código CID-10')
  if (description.length < 1) throw new ValidationError('Informe a descrição do CID')

  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  const insertRow: {
    tenant_id: string
    patient_id: string
    cid10_code: string
    cid10_description: string
    additional_notes: string | null
    status: DiagnosisStatus
    diagnosed_by: string
    diagnosed_at?: string
  } = {
    tenant_id: input.tenantId,
    patient_id: input.patientId,
    cid10_code: code,
    cid10_description: description,
    additional_notes: input.additionalNotes?.trim() || null,
    status: input.status ?? 'ativo',
    diagnosed_by: input.actorUserId,
  }
  if (input.diagnosedAt) {
    insertRow.diagnosed_at = input.diagnosedAt
  }

  const { data, error } = await supabase
    .from('patient_diagnoses')
    .insert(insertRow)
    .select(SELECT_COLUMNS)
    .single()
  if (error || !data) throw new Error(`createDiagnosis failed: ${error?.message}`)
  return toDto(data as unknown as DbRow)
}

export async function updateDiagnosisStatus(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    diagnosisId: string
    status: DiagnosisStatus
  },
): Promise<PatientDiagnosisDTO> {
  const existing = await supabase
    .from('patient_diagnoses')
    .select('id, status, deleted_at')
    .eq('tenant_id', args.tenantId)
    .eq('id', args.diagnosisId)
    .maybeSingle()
  if (existing.error) throw new Error(`diagnosis lookup: ${existing.error.message}`)
  if (!existing.data) throw new NotFoundError('patient_diagnosis', args.diagnosisId)
  if (existing.data.deleted_at) {
    throw new ConflictError('DIAGNOSIS_DELETED', 'Diagnóstico removido', {
      diagnosis_id: args.diagnosisId,
    })
  }
  if (existing.data.status === args.status) {
    throw new ConflictError(
      'DIAGNOSIS_STATUS_UNCHANGED',
      'Status já é o solicitado',
      { current: existing.data.status },
    )
  }

  const { data, error } = await supabase
    .from('patient_diagnoses')
    .update({ status: args.status })
    .eq('tenant_id', args.tenantId)
    .eq('id', args.diagnosisId)
    .select(SELECT_COLUMNS)
    .single()
  if (error || !data) throw new Error(`updateDiagnosisStatus failed: ${error?.message}`)
  return toDto(data as unknown as DbRow)
}

export async function softDeleteDiagnosis(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; diagnosisId: string },
): Promise<void> {
  const existing = await supabase
    .from('patient_diagnoses')
    .select('id, deleted_at')
    .eq('tenant_id', args.tenantId)
    .eq('id', args.diagnosisId)
    .maybeSingle()
  if (existing.error) throw new Error(`diagnosis lookup: ${existing.error.message}`)
  if (!existing.data) throw new NotFoundError('patient_diagnosis', args.diagnosisId)
  if (existing.data.deleted_at) {
    throw new ConflictError('DIAGNOSIS_ALREADY_DELETED', 'Diagnóstico já removido', {
      diagnosis_id: args.diagnosisId,
    })
  }
  const { error } = await supabase
    .from('patient_diagnoses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('tenant_id', args.tenantId)
    .eq('id', args.diagnosisId)
  if (error) throw new Error(`softDeleteDiagnosis failed: ${error.message}`)
}

function toDto(r: DbRow): PatientDiagnosisDTO {
  return {
    id: r.id,
    patientId: r.patient_id,
    cid10Code: r.cid10_code,
    cid10Description: r.cid10_description,
    additionalNotes: r.additional_notes,
    diagnosedAt: r.diagnosed_at,
    status: r.status as DiagnosisStatus,
    diagnosedBy: r.diagnosed_by,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  }
}
