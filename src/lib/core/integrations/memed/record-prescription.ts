import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { recordMemedAudit } from './audit'

/**
 * Registro auditável de prescrições (Feature 026, US3). Append-only:
 *  - emissão (`prescricaoImpressa`) → INSERT idempotente em prescription_records
 *  - exclusão (`prescricaoExcluida`) → transição issued→deleted
 * Cada operação registra `prescription.issued` / `prescription.deleted` em
 * audit_log. NÃO armazena conteúdo clínico (LGPD/minimização) — só metadados.
 */

export interface RecordIssuedInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  appointmentId: string | null
  patientId: string
  doctorId: string
  memedPrescriptionId: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface RecordIssuedResult {
  id: string | null
  /** false quando a prescrição já estava registrada (idempotência). */
  created: boolean
}

export async function recordPrescriptionIssued(
  input: RecordIssuedInput,
): Promise<RecordIssuedResult> {
  const { supabase } = input
  const { data, error } = await supabase
    .from('prescription_records')
    .insert({
      tenant_id: input.tenantId,
      appointment_id: input.appointmentId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      memed_prescription_id: input.memedPrescriptionId,
      status: 'issued',
      created_by_user_id: input.actorUserId,
    } as never)
    .select('id')
    .maybeSingle()

  if (error) {
    // UNIQUE (tenant_id, memed_prescription_id) → emissão repetida do mesmo
    // evento. Idempotente: não duplica registro nem audit.
    if (error.code === '23505') return { id: null, created: false }
    throw new Error(`recordPrescriptionIssued insert failed: ${error.message}`)
  }

  const id = (data as { id: string } | null)?.id ?? null
  await recordMemedAudit(supabase, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    entity: 'prescription_records',
    entityId: id ?? input.tenantId,
    field: 'prescription.issued',
    detail: {
      appointment_id: input.appointmentId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      memed_prescription_id: input.memedPrescriptionId,
    },
    reason: 'prescrição emitida na Memed',
    ip: input.ip,
    userAgent: input.userAgent,
  })

  return { id, created: true }
}

export interface RecordDeletedInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  memedPrescriptionId: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export async function recordPrescriptionDeleted(
  input: RecordDeletedInput,
): Promise<{ updated: boolean }> {
  const { supabase } = input
  const { data, error } = await supabase
    .from('prescription_records')
    .update({ status: 'deleted', deleted_at: new Date().toISOString() } as never)
    .eq('tenant_id', input.tenantId)
    .eq('memed_prescription_id', input.memedPrescriptionId)
    .eq('status', 'issued')
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`recordPrescriptionDeleted update failed: ${error.message}`)
  // Nenhuma linha issued → já excluída ou inexistente. Idempotente.
  if (!data) return { updated: false }

  await recordMemedAudit(supabase, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    entity: 'prescription_records',
    entityId: (data as { id: string }).id,
    field: 'prescription.deleted',
    detail: { memed_prescription_id: input.memedPrescriptionId },
    reason: 'prescrição excluída na Memed',
    ip: input.ip,
    userAgent: input.userAgent,
  })

  return { updated: true }
}
