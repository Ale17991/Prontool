import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'

export interface SoftDeleteReceiptInput {
  tenantId: string
  receiptId: string
  actorUserId: string
  reason?: string | null
}

/**
 * Soft-delete de um receipt. Não chama `storage.remove()` — o binário fica
 * preservado para auditoria. UPDATE só nos 3 campos `deleted_*` (column-guard
 * de banco rejeita qualquer outro mutation).
 */
export async function softDeleteReceipt(
  supabase: SupabaseClient<Database>,
  input: SoftDeleteReceiptInput,
): Promise<void> {
  const lookup = await supabase
    .from('expense_receipts')
    .select('id, deleted_at')
    .eq('id', input.receiptId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (lookup.error) throw new Error(`receipt lookup: ${lookup.error.message}`)
  if (!lookup.data) throw new NotFoundError('expense_receipt', input.receiptId)
  if (lookup.data.deleted_at) {
    throw new DomainError(
      'RECEIPT_ALREADY_DELETED',
      'Comprovante ja removido',
      { status: 409 },
    )
  }

  const updated = await supabase
    .from('expense_receipts')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: input.actorUserId,
      deleted_reason: input.reason ?? null,
    })
    .eq('id', input.receiptId)
    .eq('tenant_id', input.tenantId)
    .is('deleted_at', null)
    .select('id')
    .single()
  if (updated.error || !updated.data) {
    throw new Error(`soft-delete failed: ${updated.error?.message}`)
  }
}
