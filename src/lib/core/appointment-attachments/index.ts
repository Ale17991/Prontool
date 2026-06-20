import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { sniffImageType } from '@/lib/utils/image-magic-bytes'
import { createSignedUrlOrNull } from '@/lib/core/storage/signed-url'

export const APPOINTMENT_ATTACHMENT_BUCKET = 'appointment-attachments' as const
const SIGNED_TTL = 60 * 60 * 4 // 4 h
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024 // 5 MB

export interface AttachmentRow {
  id: string
  fileName: string
  kind: string
  uploadedAt: string
  signedUrl: string | null
}

export async function uploadAppointmentAttachment(
  supabase: SupabaseClient<Database>,
  input: {
    tenantId: string
    appointmentId: string
    actorUserId: string
    file: { arrayBuffer(): Promise<ArrayBuffer>; size: number; name?: string }
    kind?: 'material_label' | 'other'
  },
): Promise<AttachmentRow> {
  if (input.file.size > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError('Imagem excede 5 MB', { reason: 'payload_too_large' })
  }
  const buffer = await input.file.arrayBuffer()
  const sniffed = sniffImageType(buffer)
  if (!sniffed) throw new ValidationError('Apenas imagens JPG ou PNG.', { reason: 'invalid_image' })

  const path = `${input.tenantId}/${input.appointmentId}/${randomUUID()}.${sniffed}`
  const contentType = sniffed === 'png' ? 'image/png' : 'image/jpeg'
  const { error: upErr } = await supabase.storage
    .from(APPOINTMENT_ATTACHMENT_BUCKET)
    .upload(path, buffer, { upsert: false, contentType })
  if (upErr) throw new Error(`uploadAppointmentAttachment storage failed: ${upErr.message}`)

  const fileName = (input.file.name ?? 'etiqueta').slice(0, 200)
  const { data, error } = await supabase
    .from('appointment_attachments' as never)
    .insert({
      tenant_id: input.tenantId,
      appointment_id: input.appointmentId,
      storage_path: path,
      file_name: fileName,
      content_type: contentType,
      file_size_bytes: input.file.size,
      kind: input.kind ?? 'material_label',
      uploaded_by: input.actorUserId,
    } as never)
    .select('id, uploaded_at')
    .single()
  if (error) {
    await supabase.storage.from(APPOINTMENT_ATTACHMENT_BUCKET).remove([path])
    throw new Error(`uploadAppointmentAttachment insert failed: ${error.message}`)
  }

  const signedUrl = await createSignedUrlOrNull(supabase, APPOINTMENT_ATTACHMENT_BUCKET, path, SIGNED_TTL)
  const row = data as { id: string; uploaded_at: string }
  return { id: row.id, fileName, kind: input.kind ?? 'material_label', uploadedAt: row.uploaded_at, signedUrl }
}

export async function listAppointmentAttachments(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; appointmentId: string },
): Promise<AttachmentRow[]> {
  const { data, error } = await supabase
    .from('appointment_attachments' as never)
    .select('id, file_name, kind, uploaded_at, storage_path')
    .eq('tenant_id', args.tenantId)
    .eq('appointment_id', args.appointmentId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })
  if (error) throw new Error(`listAppointmentAttachments failed: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    file_name: string
    kind: string
    uploaded_at: string
    storage_path: string
  }>
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      fileName: r.file_name,
      kind: r.kind,
      uploadedAt: r.uploaded_at,
      signedUrl: await createSignedUrlOrNull(supabase, APPOINTMENT_ATTACHMENT_BUCKET, r.storage_path, SIGNED_TTL),
    })),
  )
}

export async function deleteAppointmentAttachment(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string; actorUserId: string },
): Promise<void> {
  const { data } = await supabase
    .from('appointment_attachments' as never)
    .select('storage_path')
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
    .maybeSingle()
  const path = (data as { storage_path?: string } | null)?.storage_path
  if (!path) return

  await supabase.storage.from(APPOINTMENT_ATTACHMENT_BUCKET).remove([path])
  await supabase
    .from('appointment_attachments' as never)
    .update({ deleted_at: new Date().toISOString(), deleted_by: args.actorUserId } as never)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id)
}
