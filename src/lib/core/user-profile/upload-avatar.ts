import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { sniffImageType } from '@/lib/utils/image-magic-bytes'
import { createSignedUrlOrNull } from '@/lib/core/storage/signed-url'
import {
  MAX_AVATAR_BYTES,
  USER_AVATAR_BUCKET,
  USER_AVATAR_SIGNED_URL_TTL_SECONDS,
  type UserProfileAvatar,
} from './types'

interface UploadContext {
  ip?: string | null
  userAgent?: string | null
}

/**
 * Sobe (ou substitui) o avatar do usuário. Path =
 * `{tenant_id}/{user_id}.{ext}` — o tenant prefix permite RLS por
 * primeiro segmento e o user_id permite que policies de write/update
 * limitem ao dono.
 */
export async function uploadUserAvatar(
  supabase: SupabaseClient<Database>,
  userId: string,
  email: string | null,
  tenantId: string,
  file: { arrayBuffer(): Promise<ArrayBuffer>; size: number; type?: string },
  context: UploadContext = {},
): Promise<UserProfileAvatar> {
  if (file.size > MAX_AVATAR_BYTES) {
    throw new ValidationError('Avatar excede 2 MB', { reason: 'payload_too_large', size: file.size })
  }
  const buffer = await file.arrayBuffer()
  const sniffed = sniffImageType(buffer)
  if (!sniffed) {
    throw new ValidationError('Formato de imagem inválido (apenas JPG ou PNG)', {
      reason: 'invalid_image_format',
    })
  }

  const newPath = `${tenantId}/${userId}.${sniffed}`

  // Read current path para audit + cleanup de extensão alternativa.
  const { data: current, error: readError } = await supabase
    .from('user_profile')
    .select('avatar_path')
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) throw new Error(`uploadUserAvatar read current failed: ${readError.message}`)
  const oldPath = (current?.avatar_path as string | null) ?? null

  const contentType = sniffed === 'png' ? 'image/png' : 'image/jpeg'
  const { error: uploadError } = await supabase.storage
    .from(USER_AVATAR_BUCKET)
    .upload(newPath, buffer, { upsert: true, contentType })
  if (uploadError) {
    throw new Error(`uploadUserAvatar storage failed: ${uploadError.message}`)
  }

  if (oldPath && oldPath !== newPath) {
    await supabase.storage.from(USER_AVATAR_BUCKET).remove([oldPath])
  }

  const uploadedAt = new Date().toISOString()
  const { error: upsertError } = await supabase
    .from('user_profile')
    .upsert(
      { user_id: userId, avatar_path: newPath, avatar_uploaded_at: uploadedAt },
      { onConflict: 'user_id' },
    )
  if (upsertError) {
    throw new Error(`uploadUserAvatar upsert profile failed: ${upsertError.message}`)
  }

  await supabase.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: userId,
    actor_label: email,
    entity: 'user_profile',
    entity_id: userId,
    field: 'avatar',
    old_value: oldPath,
    new_value: newPath,
    reason: 'avatar uploaded via /api/configuracoes/perfil/avatar POST',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  })

  const signedUrl = await createSignedUrlOrNull(
    supabase,
    USER_AVATAR_BUCKET,
    newPath,
    USER_AVATAR_SIGNED_URL_TTL_SECONDS,
  )
  return { path: newPath, signedUrl, uploadedAt }
}

export async function deleteUserAvatar(
  supabase: SupabaseClient<Database>,
  userId: string,
  email: string | null,
  tenantId: string,
  context: UploadContext = {},
): Promise<void> {
  const { data: current } = await supabase
    .from('user_profile')
    .select('avatar_path')
    .eq('user_id', userId)
    .maybeSingle()
  const oldPath = (current?.avatar_path as string | null) ?? null
  if (!oldPath) return

  await supabase.storage.from(USER_AVATAR_BUCKET).remove([oldPath])

  await supabase
    .from('user_profile')
    .update({ avatar_path: null, avatar_uploaded_at: null })
    .eq('user_id', userId)

  await supabase.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: userId,
    actor_label: email,
    entity: 'user_profile',
    entity_id: userId,
    field: 'avatar',
    old_value: oldPath,
    new_value: null,
    reason: 'avatar removed via /api/configuracoes/perfil/avatar DELETE',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  })
}
