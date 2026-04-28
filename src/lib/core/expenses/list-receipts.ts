import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface ExpenseReceiptRow {
  id: string
  expenseId: string
  fileName: string
  storagePath: string
  fileSizeBytes: number
  contentType: string
  uploadedAt: string
  uploadedBy: string
  deletedAt: string | null
  deletedBy: string | null
  deletedReason: string | null
}

export interface ListReceiptsInput {
  tenantId: string
  expenseId: string
  /** Quando true, inclui receipts com `deleted_at` preenchido. Default false. */
  includeDeleted?: boolean
}

/**
 * Lista receipts ativos (ou todos, se `includeDeleted`) de uma despesa.
 * Retorna ordenado por uploaded_at ASC para que o numero `-1`, `-2` faca sentido na UI.
 */
export async function listReceiptsForExpense(
  supabase: SupabaseClient<Database>,
  input: ListReceiptsInput,
): Promise<ExpenseReceiptRow[]> {
  let q = supabase
    .from('expense_receipts')
    .select(
      'id, expense_id, file_name, storage_path, file_size_bytes, content_type, uploaded_at, uploaded_by, deleted_at, deleted_by, deleted_reason',
    )
    .eq('tenant_id', input.tenantId)
    .eq('expense_id', input.expenseId)
    .order('uploaded_at', { ascending: true })
  if (!input.includeDeleted) {
    q = q.is('deleted_at', null)
  }
  const result = await q
  if (result.error) throw new Error(`expense_receipts list: ${result.error.message}`)
  return (result.data ?? []).map<ExpenseReceiptRow>((r) => ({
    id: r.id,
    expenseId: r.expense_id,
    fileName: r.file_name,
    storagePath: r.storage_path,
    fileSizeBytes: r.file_size_bytes,
    contentType: r.content_type,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by,
    deletedAt: r.deleted_at,
    deletedBy: r.deleted_by,
    deletedReason: r.deleted_reason,
  }))
}

export interface ReceiptCountByExpense {
  expenseId: string
  count: number
}

/**
 * Conta receipts ativos por expense_id em batch — usado pela tabela de despesas
 * para mostrar o clipe + contagem sem buscar cada item.
 */
export async function countReceiptsByExpense(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; expenseIds: string[] },
): Promise<Map<string, number>> {
  if (args.expenseIds.length === 0) return new Map()
  const result = await supabase
    .from('expense_receipts')
    .select('expense_id')
    .eq('tenant_id', args.tenantId)
    .in('expense_id', args.expenseIds)
    .is('deleted_at', null)
  if (result.error) throw new Error(`expense_receipts count: ${result.error.message}`)
  const map = new Map<string, number>()
  for (const r of result.data ?? []) {
    map.set(r.expense_id, (map.get(r.expense_id) ?? 0) + 1)
  }
  return map
}
