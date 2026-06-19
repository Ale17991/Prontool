import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { sniffImageType } from '@/lib/utils/image-magic-bytes'
import { createSignedUrlOrNull } from '@/lib/core/storage/signed-url'

export const PATIENT_PHOTO_BUCKET = 'patient-photos' as const
export const PATIENT_PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 // 24 h
export const MAX_PATIENT_PHOTO_BYTES = 3 * 1024 * 1024 // 3 MB

export interface PatientPhoto {
  path: string
  signedUrl: string | null
  uploadedAt: string
}

/**
 * Backlog 1/1 — sobe/substitui a foto do paciente. Path =
 * `{tenant_id}/{patient_id}.{ext}`. Espelha uploadUserAvatar.
 */
export async function uploadPatientPhoto(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
  actorUserId: string,
  file: { arrayBuffer(): Promise<ArrayBuffer>; size: number; type?: string },
): Promise<PatientPhoto> {
  if (file.size > MAX_PATIENT_PHOTO_BYTES) {
    throw new ValidationError('Foto excede 3 MB', { reason: 'payload_too_large', size: file.size })
  }
  const buffer = await file.arrayBuffer()
  const sniffed = sniffImageType(buffer)
  if (!sniffed) {
    throw new ValidationError('Formato de imagem inválido (apenas JPG ou PNG)', {
      reason: 'invalid_image_format',
    })
  }

  const newPath = `${tenantId}/${patientId}.${sniffed}`

  const { data: current, error: readErr } = await supabase
    .from('patients')
    .select('photo_path')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (readErr) throw new Error(`uploadPatientPhoto read failed: ${readErr.message}`)
  if (!current) throw new ValidationError('Paciente não encontrado.')
  const oldPath = (current as { photo_path: string | null }).photo_path ?? null

  const contentType = sniffed === 'png' ? 'image/png' : 'image/jpeg'
  const { error: upErr } = await supabase.storage
    .from(PATIENT_PHOTO_BUCKET)
    .upload(newPath, buffer, { upsert: true, contentType })
  if (upErr) throw new Error(`uploadPatientPhoto storage failed: ${upErr.message}`)

  if (oldPath && oldPath !== newPath) {
    await supabase.storage.from(PATIENT_PHOTO_BUCKET).remove([oldPath])
  }

  const uploadedAt = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('patients')
    .update({ photo_path: newPath, photo_uploaded_at: uploadedAt } as never)
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
  if (updErr) throw new Error(`uploadPatientPhoto update failed: ${updErr.message}`)

  await supabase.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorUserId,
    actor_label: null,
    entity: 'patients',
    entity_id: patientId,
    field: 'photo',
    old_value: oldPath,
    new_value: newPath,
    reason: 'foto do paciente enviada via /api/pacientes/[id]/foto POST',
    result: 'success',
  } as never)

  const signedUrl = await createSignedUrlOrNull(
    supabase,
    PATIENT_PHOTO_BUCKET,
    newPath,
    PATIENT_PHOTO_SIGNED_URL_TTL_SECONDS,
  )
  return { path: newPath, signedUrl, uploadedAt }
}

export async function deletePatientPhoto(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
  actorUserId: string,
): Promise<void> {
  const { data: current } = await supabase
    .from('patients')
    .select('photo_path')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const oldPath = (current as { photo_path: string | null } | null)?.photo_path ?? null
  if (!oldPath) return

  await supabase.storage.from(PATIENT_PHOTO_BUCKET).remove([oldPath])
  await supabase
    .from('patients')
    .update({ photo_path: null, photo_uploaded_at: null } as never)
    .eq('id', patientId)
    .eq('tenant_id', tenantId)

  await supabase.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorUserId,
    actor_label: null,
    entity: 'patients',
    entity_id: patientId,
    field: 'photo',
    old_value: oldPath,
    new_value: null,
    reason: 'foto do paciente removida via /api/pacientes/[id]/foto DELETE',
    result: 'success',
  } as never)
}
