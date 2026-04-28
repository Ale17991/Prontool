import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError, ValidationError } from '@/lib/observability/errors'

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
  receiptId: string
  expenseId: string
  fileName: string
  storagePath: string
  fileSizeBytes: number
  contentType: string
}

/**
 * Upload de um comprovante (1 entry em `expense_receipts`).
 * Path: {tenant_id}/{expense_id}/{filename}. Conflito de nome resolve com sufixo `-N`.
 *
 * Atomicidade: storage primeiro, INSERT depois. Se INSERT falhar, remove o objeto.
 */
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

  const safeBase = sanitizeFilename(input.fileName)
  const ext = safeBase.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXT.has(ext)) {
    throw new ValidationError(
      'Tipo de arquivo nao suportado. Use PDF, JPG, JPEG ou PNG.',
      { extension: ext },
    )
  }
  const contentType = (input.contentType || '').toLowerCase()
  if (contentType && !ALLOWED_MIME.has(contentType)) {
    throw new ValidationError(
      'Content-type nao suportado. Use PDF, JPG, JPEG ou PNG.',
      { content_type: input.contentType },
    )
  }

  const expense = await supabase
    .from('expenses')
    .select('id, deleted_at')
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

  const finalName = await resolveUniqueName(supabase, {
    tenantId: input.tenantId,
    expenseId: input.expenseId,
    baseName: safeBase,
  })
  const storagePath = `${input.tenantId}/${input.expenseId}/${finalName}`

  const upload = await supabase.storage.from(BUCKET).upload(storagePath, input.file, {
    upsert: false,
    contentType: contentType || 'application/octet-stream',
  })
  if (upload.error) throw new Error(`storage upload failed: ${upload.error.message}`)

  const inserted = await supabase
    .from('expense_receipts')
    .insert({
      tenant_id: input.tenantId,
      expense_id: input.expenseId,
      file_name: finalName,
      storage_path: storagePath,
      file_size_bytes: size,
      content_type: contentType || 'application/octet-stream',
      uploaded_by: input.actorUserId,
    })
    .select('id, file_name, storage_path, file_size_bytes, content_type')
    .single()

  if (inserted.error || !inserted.data) {
    await supabase.storage
      .from(BUCKET)
      .remove([storagePath])
      .catch(() => undefined)
    throw new Error(`expense_receipts insert failed: ${inserted.error?.message}`)
  }

  return {
    receiptId: inserted.data.id,
    expenseId: input.expenseId,
    fileName: inserted.data.file_name,
    storagePath: inserted.data.storage_path,
    fileSizeBytes: inserted.data.file_size_bytes,
    contentType: inserted.data.content_type,
  }
}

export const uploadReceipt = uploadExpenseReceipt

async function resolveUniqueName(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; expenseId: string; baseName: string },
): Promise<string> {
  const existing = await supabase
    .from('expense_receipts')
    .select('file_name')
    .eq('tenant_id', args.tenantId)
    .eq('expense_id', args.expenseId)
    .is('deleted_at', null)
  if (existing.error) {
    throw new Error(`expense_receipts list: ${existing.error.message}`)
  }
  const taken = new Set((existing.data ?? []).map((r) => r.file_name))
  if (!taken.has(args.baseName)) return args.baseName

  const dot = args.baseName.lastIndexOf('.')
  const stem = dot > 0 ? args.baseName.slice(0, dot) : args.baseName
  const ext = dot > 0 ? args.baseName.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!taken.has(candidate)) return candidate
  }
  throw new DomainError(
    'RECEIPT_NAME_EXHAUSTED',
    'Limite de variacoes de nome atingido',
    { status: 409 },
  )
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
