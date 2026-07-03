import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

/**
 * Soft-delete em lote de dados clínicos do paciente. NUNCA toca em
 * appointments, appointment_reversals, audit_log nem qualquer dado
 * financeiro/regulatório — esses são protegidos por lei.
 *
 * Admin-only (gating no handler). Cada UPDATE dispara o trigger de
 * auditoria correspondente, preservando trilha completa.
 */
export interface BulkCleanupInput {
  tenantId: string
  patientId: string
  removeAnamneses: boolean
  removeRecords: boolean
  removeSteps: boolean
}

export interface BulkCleanupResult {
  anamneses: number
  records: number
  steps: number
}

export async function bulkCleanupPatient(
  supabase: SupabaseClient<Database>,
  input: BulkCleanupInput,
): Promise<BulkCleanupResult> {
  if (!input.removeAnamneses && !input.removeRecords && !input.removeSteps) {
    throw new ValidationError('Selecione ao menos um tipo de dado para remover')
  }

  // Sanity check — paciente pertence ao tenant?
  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup failed: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  const deletedAt = new Date().toISOString()
  const result: BulkCleanupResult = { anamneses: 0, records: 0, steps: 0 }

  if (input.removeAnamneses) {
    const { data, error } = await supabase
      .from('clinical_records')
      .update({ deleted_at: deletedAt })
      .eq('tenant_id', input.tenantId)
      .eq('patient_id', input.patientId)
      .eq('type', 'anamnese')
      .is('deleted_at', null)
      .select('id')
    if (error) throw new Error(`bulkCleanup anamneses failed: ${error.message}`)
    result.anamneses = data?.length ?? 0
  }

  if (input.removeRecords) {
    const { data, error } = await supabase
      .from('clinical_records')
      .update({ deleted_at: deletedAt })
      .eq('tenant_id', input.tenantId)
      .eq('patient_id', input.patientId)
      .in('type', ['texto', 'arquivo'])
      .is('deleted_at', null)
      .select('id')
    if (error) throw new Error(`bulkCleanup records failed: ${error.message}`)
    result.records = data?.length ?? 0
  }

  if (input.removeSteps) {
    const { data, error } = await supabase
      .from('treatment_plan_steps')
      .update({ deleted_at: deletedAt })
      .eq('tenant_id', input.tenantId)
      .eq('patient_id', input.patientId)
      .is('deleted_at', null)
      .select('id')
    if (error) throw new Error(`bulkCleanup steps failed: ${error.message}`)
    result.steps = data?.length ?? 0
  }

  return result
}
