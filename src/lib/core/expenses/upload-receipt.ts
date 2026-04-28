import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError, ValidationError } from '@/lib/observability/errors'

/**
 * Upload do comprovante de uma despesa para o bucket `expense-receipts`.
 * Path: {tenant_id}/{expense_id}/{filename}.
 *
 * Limites:
 *   - 10 MB por arquivo (alinhado ao CHECK em expenses.receipt_file_size)
 *   - tipos: PDF, JPG, JPEG, PNG (validacao por extensao + content-type)
 *
 * Atomicidade: upload primeiro, depois UPDATE. Se o UPDATE falhar,
 * tenta remover o objeto para evitar arquivo orfao.
 *
 * Substituicao: se a despesa ja tem comprovante, apaga o anterior antes
 * de subir o novo (mantem trilha de auditoria via audit_log gerado pelos
 * triggers de expenses).
 */
const BUCKET = 'expense-receipts'
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png'])
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
])

export interface UploadReceiptInput {
  tenantId: string
  expenseId: string
  file: File | Blob
  fileName: string
  contentType: string
  actorUserId: string
}

export interface UploadReceiptResult {
  expenseId: string
  fileName: string
  fileUrl: string
  fileSize: number
}

export async function uploadExpenseReceipt(
  supabase: SupabaseClient<Database>,
  input: UploadReceiptInput,
): Promise<UploadReceiptResult> {
  const size = input.file.size
  if (size <= 0) throw new ValidationError('Arquivo vazio')
  if (size > MAX_BYTES) {
    throw new ValidationError(`Arquivo excede limite de ${MAX_BYTES / 1024 / 1024} MB`, {
      size_bytes: size,
    })
  }

  const safeName = sanitizeFilename(input.fileName)
  const ext = safeName.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXT.has(ext)) {
    throw new ValidationError(
      'Tipo de arquivo nao suportado. Use PDF, JPG, JPEG ou PNG.',
      { extension: ext },
    )
  }
  if (input.contentType && !ALLOWED_MIME.has(input.contentType.toLowerCase())) {
    throw new ValidationError(
      'Content-type nao suportado. Use PDF, JPG, JPEG ou PNG.',
      { content_type: input.contentType },
    )
  }

  // Verifica que a despesa existe e pertence ao tenant.
  const expense = await supabase
    .from('expenses')
    .select('id, receipt_file_url, deleted_at')
    .eq('id', input.expenseId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (expense.error) {
    throw new Error(`expense lookup: ${expense.error.message}`)
  }
  if (!expense.data) throw new NotFoundError('expense', input.expenseId)
  if (expense.data.deleted_at) {
    throw new DomainError(
      'EXPENSE_DELETED',
      'Despesa apagada nao aceita novo comprovante',
      { status: 409 },
    )
  }

  const path = `${input.tenantId}/${input.expenseId}/${safeName}`

  // Se ja existia comprovante, apaga primeiro (substituicao).
  const previousPath = expense.data.receipt_file_url
  if (previousPath && previousPath !== path) {
    await supabase.storage
      .from(BUCKET)
      .remove([previousPath])
      .catch(() => undefined)
  }

  const upload = await supabase.storage.from(BUCKET).upload(path, input.file, {
    upsert: true,
    contentType: input.contentType || 'application/octet-stream',
  })
  if (upload.error) throw new Error(`storage upload failed: ${upload.error.message}`)

  // UPDATE da despesa para registrar o comprovante.
  const updated = await supabase
    .from('expenses')
    .update({
      receipt_file_name: safeName,
      receipt_file_url: path,
      receipt_file_size: size,
    })
    .eq('id', input.expenseId)
    .eq('tenant_id', input.tenantId)
    .select('id')
    .single()

  if (updated.error || !updated.data) {
    // Cleanup do storage se o UPDATE falhar.
    await supabase.storage
      .from(BUCKET)
      .remove([path])
      .catch(() => undefined)
    throw new Error(`expense receipt update failed: ${updated.error?.message}`)
  }

  return {
    expenseId: input.expenseId,
    fileName: safeName,
    fileUrl: path,
    fileSize: size,
  }
}

export async function removeExpenseReceipt(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; expenseId: string },
): Promise<void> {
  const expense = await supabase
    .from('expenses')
    .select('id, receipt_file_url')
    .eq('id', args.expenseId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()
  if (expense.error) throw new Error(`expense lookup: ${expense.error.message}`)
  if (!expense.data) throw new NotFoundError('expense', args.expenseId)
  if (!expense.data.receipt_file_url) {
    throw new DomainError(
      'NO_RECEIPT',
      'Despesa nao tem comprovante anexado',
      { status: 404 },
    )
  }

  const path = expense.data.receipt_file_url

  // Apaga do storage primeiro; se falhar, mantem a row consistente.
  const removed = await supabase.storage.from(BUCKET).remove([path])
  if (removed.error) {
    throw new Error(`storage remove failed: ${removed.error.message}`)
  }

  const updated = await supabase
    .from('expenses')
    .update({
      receipt_file_name: null,
      receipt_file_url: null,
      receipt_file_size: null,
    })
    .eq('id', args.expenseId)
    .eq('tenant_id', args.tenantId)
  if (updated.error) {
    throw new Error(`expense receipt clear failed: ${updated.error.message}`)
  }
}

export async function getExpenseReceiptSignedUrl(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; expenseId: string; expiresIn?: number },
): Promise<{ url: string; fileName: string }> {
  const expense = await supabase
    .from('expenses')
    .select('id, receipt_file_url, receipt_file_name')
    .eq('id', args.expenseId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()
  if (expense.error) throw new Error(`expense lookup: ${expense.error.message}`)
  if (!expense.data) throw new NotFoundError('expense', args.expenseId)
  if (!expense.data.receipt_file_url) {
    throw new DomainError(
      'NO_RECEIPT',
      'Despesa nao tem comprovante anexado',
      { status: 404 },
    )
  }

  const signed = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(expense.data.receipt_file_url, args.expiresIn ?? 60)
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(`signed URL failed: ${signed.error?.message}`)
  }

  return {
    url: signed.data.signedUrl,
    fileName: expense.data.receipt_file_name ?? 'comprovante',
  }
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/]/g, '_')
      .replace(/[\x00-\x1f]/g, '')
      .slice(0, 200)
      .trim() || 'arquivo'
  )
}
