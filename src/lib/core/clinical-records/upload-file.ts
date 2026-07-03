import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { createClinicalFileRecord, type ClinicalRecordRow } from './create'

/**
 * Faz upload do arquivo pra `clinical-files` (path
 * `{tenant_id}/{patient_id}/{record_id}-{filename}`) usando o cliente
 * service-role e cria a linha em `clinical_records` apontando pra ele.
 *
 * Limites:
 *   - 25 MB por arquivo (sanity check, não vinculado ao bucket)
 *   - tipos sem restrição aqui — front pode whitelist se quiser
 *
 * Falha do upload deixa nada na DB. Falha do INSERT após upload
 * tenta remover o objeto pra evitar arquivo órfão.
 */
const MAX_BYTES = 25 * 1024 * 1024
const BUCKET = 'clinical-files'

export interface UploadFileInput {
  tenantId: string
  patientId: string
  title: string
  file: File | Blob
  fileName: string
  actorUserId: string
}

export async function uploadClinicalFile(
  supabase: SupabaseClient<Database>,
  input: UploadFileInput,
): Promise<ClinicalRecordRow> {
  const size = input.file.size
  if (size <= 0) throw new ValidationError('Arquivo vazio')
  if (size > MAX_BYTES) {
    throw new ValidationError(`Arquivo excede limite de ${MAX_BYTES / 1024 / 1024} MB`, {
      size_bytes: size,
    })
  }

  const recordId = randomUUID()
  const safeName = sanitizeFilename(input.fileName)
  const path = `${input.tenantId}/${input.patientId}/${recordId}-${safeName}`

  const upload = await supabase.storage.from(BUCKET).upload(path, input.file, {
    upsert: false,
    contentType: input.file.type || 'application/octet-stream',
  })
  if (upload.error) throw new Error(`storage upload failed: ${upload.error.message}`)

  try {
    return await createClinicalFileRecord(supabase, {
      tenantId: input.tenantId,
      patientId: input.patientId,
      title: input.title,
      fileName: safeName,
      fileUrl: path,
      fileSizeBytes: size,
      actorUserId: input.actorUserId,
    })
  } catch (err) {
    // Best-effort cleanup; ignore failure (would log via outer handler).
    await supabase.storage
      .from(BUCKET)
      .remove([path])
      .catch(() => undefined)
    throw err
  }
}

function sanitizeFilename(name: string): string {
  // Remove path separators and control chars; keep extension.
  return (
    name
      .replace(/[\\/]/g, '_')
      .replace(/[\x00-\x1f]/g, '')
      .slice(0, 200)
      .trim() || 'arquivo'
  )
}
