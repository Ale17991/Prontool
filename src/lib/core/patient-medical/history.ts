import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'

export type HistoryCategory =
  | 'doenca_pregressa'
  | 'cirurgia'
  | 'medicamento_uso_continuo'
  | 'antecedente_familiar'
  | 'habito'
  | 'outro'

export interface PatientHistoryDTO {
  id: string
  patientId: string
  category: HistoryCategory
  description: string
  dateReported: string | null
  notes: string | null
  reportedBy: string
  createdAt: string
  deletedAt: string | null
}

interface DbRow {
  id: string
  tenant_id: string
  patient_id: string
  category: string
  description: string
  date_reported: string | null
  notes: string | null
  reported_by: string
  created_at: string
  deleted_at: string | null
}

export async function listHistory(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; includeDeleted?: boolean },
): Promise<PatientHistoryDTO[]> {
  let q = supabase
    .from('patient_history')
    .select(
      'id, tenant_id, patient_id, category, description, date_reported, notes, reported_by, created_at, deleted_at',
    )
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('created_at', { ascending: false })
  if (!args.includeDeleted) q = q.is('deleted_at', null)
  const { data, error } = await q
  if (error) throw new Error(`listHistory failed: ${error.message}`)
  return ((data ?? []) as DbRow[]).map(toDto)
}

export interface CreateHistoryInput {
  tenantId: string
  patientId: string
  category: HistoryCategory
  description: string
  dateReported?: string | null
  notes?: string | null
  actorUserId: string
}

export async function createHistory(
  supabase: SupabaseClient<Database>,
  input: CreateHistoryInput,
): Promise<PatientHistoryDTO> {
  if (input.description.trim().length < 1) {
    throw new ValidationError('Informe a descrição do antecedente')
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
    .from('patient_history')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      category: input.category,
      description: input.description.trim(),
      date_reported: input.dateReported ?? null,
      notes: input.notes?.trim() || null,
      reported_by: input.actorUserId,
    })
    .select(
      'id, tenant_id, patient_id, category, description, date_reported, notes, reported_by, created_at, deleted_at',
    )
    .single()
  if (error || !data) throw new Error(`createHistory failed: ${error?.message}`)
  return toDto(data as DbRow)
}

export async function softDeleteHistory(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; historyId: string },
): Promise<void> {
  const existing = await supabase
    .from('patient_history')
    .select('id, deleted_at')
    .eq('tenant_id', args.tenantId)
    .eq('id', args.historyId)
    .maybeSingle()
  if (existing.error) throw new Error(`history lookup: ${existing.error.message}`)
  if (!existing.data) throw new NotFoundError('patient_history', args.historyId)
  if (existing.data.deleted_at) {
    throw new ConflictError('HISTORY_ALREADY_DELETED', 'Antecedente já removido', {
      history_id: args.historyId,
    })
  }
  const { error } = await supabase
    .from('patient_history')
    .update({ deleted_at: new Date().toISOString() })
    .eq('tenant_id', args.tenantId)
    .eq('id', args.historyId)
  if (error) throw new Error(`softDeleteHistory failed: ${error.message}`)
}

function toDto(r: DbRow): PatientHistoryDTO {
  return {
    id: r.id,
    patientId: r.patient_id,
    category: r.category as HistoryCategory,
    description: r.description,
    dateReported: r.date_reported,
    notes: r.notes,
    reportedBy: r.reported_by,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  }
}
