import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ConflictError } from '@/lib/observability/errors'

/**
 * Soft-delete: seta `deleted_at = now()`. Linha não é removida
 * fisicamente (append-only). Trigger de auditoria registra a mudança
 * com `result='success'` e `field='deleted_at'`.
 *
 * Idempotente: chamar em registro já deletado retorna `ConflictError`
 * pra que o handler responda 409 e não silenciosamente "deletar de novo"
 * (que sobrescreveria o timestamp original na trilha).
 */
export async function softDeleteClinicalRecord(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; recordId: string },
): Promise<{ id: string; deletedAt: string }> {
  const existing = await supabase
    .from('clinical_records')
    .select('id, deleted_at')
    .eq('id', args.recordId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()
  if (existing.error) throw new Error(`record lookup failed: ${existing.error.message}`)
  if (!existing.data) throw new NotFoundError('clinical_record', args.recordId)
  if (existing.data.deleted_at) {
    throw new ConflictError('CLINICAL_RECORD_ALREADY_DELETED', 'Registro já foi removido', {
      record_id: args.recordId,
      deleted_at: existing.data.deleted_at,
    })
  }

  const deletedAt = new Date().toISOString()
  const { error: upErr } = await supabase
    .from('clinical_records')
    .update({ deleted_at: deletedAt })
    .eq('id', args.recordId)
    .eq('tenant_id', args.tenantId)
  if (upErr) throw new Error(`softDeleteClinicalRecord update failed: ${upErr.message}`)

  return { id: args.recordId, deletedAt }
}
