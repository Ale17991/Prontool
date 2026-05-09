import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { sniffImageType } from '@/lib/utils/image-magic-bytes'
import {
  CLINIC_LOGO_BUCKET,
  CLINIC_LOGO_SIGNED_URL_TTL_SECONDS,
  MAX_LOGO_BYTES,
  type ClinicProfileLogo,
} from './types'
import { createSignedUrlOrNull } from '@/lib/core/storage/signed-url'

interface UploadContext {
  ip?: string | null
  userAgent?: string | null
}

/**
 * Sobe (ou substitui) a logo da clínica.
 *
 * Validação:
 *   1. Tamanho ≤ 2 MB (research.md R5).
 *   2. Magic bytes JPG/PNG — sniff binário no primeiro chunk.
 *
 * Path resultante: `{tenant_id}/logo.{jpg|png}`. Como o nome é
 * determinístico, `upsert: true` garante que substituímos a logo anterior
 * sem deixar blobs órfãos.
 *
 * Audit: insere uma linha em `audit_log` (entity=tenant_clinic_profile,
 * field=logo) com `old_value` = path antigo (se houver) e `new_value` =
 * path novo.
 */
export async function uploadClinicLogo(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  actorId: string,
  file: { arrayBuffer(): Promise<ArrayBuffer>; size: number; type?: string },
  context: UploadContext = {},
): Promise<ClinicProfileLogo> {
  if (file.size > MAX_LOGO_BYTES) {
    throw new ValidationError('Logo excede 2 MB', { reason: 'payload_too_large', size: file.size })
  }

  const buffer = await file.arrayBuffer()
  const sniffed = sniffImageType(buffer)
  if (!sniffed) {
    throw new ValidationError('Formato de imagem inválido (apenas JPG ou PNG)', {
      reason: 'invalid_image_format',
    })
  }

  const newPath = `${tenantId}/logo.${sniffed}`

  // Lê path atual (para audit + cleanup de extensão diferente).
  const { data: current, error: readError } = await supabase
    .from('tenant_clinic_profile')
    .select('logo_path')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (readError) throw new Error(`uploadClinicLogo read current failed: ${readError.message}`)
  const oldPath = (current?.logo_path as string | null) ?? null

  const contentType = sniffed === 'png' ? 'image/png' : 'image/jpeg'
  const { error: uploadError } = await supabase.storage
    .from(CLINIC_LOGO_BUCKET)
    .upload(newPath, buffer, { upsert: true, contentType })
  if (uploadError) {
    throw new Error(`uploadClinicLogo storage upload failed: ${uploadError.message}`)
  }

  // Se o upload mudou de extensão (png→jpg ou vice-versa), o arquivo antigo
  // permanece. Remove explicitamente.
  if (oldPath && oldPath !== newPath) {
    await supabase.storage.from(CLINIC_LOGO_BUCKET).remove([oldPath])
  }

  const uploadedAt = new Date().toISOString()

  // Garante que a row existe (caso primeiro acesso seja via upload).
  const { error: upsertError } = await supabase
    .from('tenant_clinic_profile')
    .upsert(
      { tenant_id: tenantId, logo_path: newPath, logo_uploaded_at: uploadedAt },
      { onConflict: 'tenant_id' },
    )
  if (upsertError) {
    throw new Error(`uploadClinicLogo upsert profile failed: ${upsertError.message}`)
  }

  // Audit (Princípio II).
  const { error: auditError } = await supabase.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorId,
    actor_label: null,
    entity: 'tenant_clinic_profile',
    entity_id: tenantId,
    field: 'logo',
    old_value: oldPath,
    new_value: newPath,
    reason: 'logo uploaded via /api/configuracoes/clinica/logo POST',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  })
  if (auditError) {
    console.error('uploadClinicLogo audit insert failed', { error: auditError })
  }

  const signedUrl = await createSignedUrlOrNull(
    supabase,
    CLINIC_LOGO_BUCKET,
    newPath,
    CLINIC_LOGO_SIGNED_URL_TTL_SECONDS,
  )

  return { path: newPath, signedUrl, uploadedAt }
}

/**
 * Remove a logo atual: apaga o objeto do Storage e zera as colunas no
 * profile, com audit.
 */
export async function deleteClinicLogo(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  actorId: string,
  context: UploadContext = {},
): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from('tenant_clinic_profile')
    .select('logo_path')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (readError) throw new Error(`deleteClinicLogo read failed: ${readError.message}`)
  const oldPath = (current?.logo_path as string | null) ?? null
  if (!oldPath) return

  await supabase.storage.from(CLINIC_LOGO_BUCKET).remove([oldPath])

  const { error: updateError } = await supabase
    .from('tenant_clinic_profile')
    .update({ logo_path: null, logo_uploaded_at: null })
    .eq('tenant_id', tenantId)
  if (updateError) throw new Error(`deleteClinicLogo update failed: ${updateError.message}`)

  await supabase.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorId,
    actor_label: null,
    entity: 'tenant_clinic_profile',
    entity_id: tenantId,
    field: 'logo',
    old_value: oldPath,
    new_value: null,
    reason: 'logo removed via /api/configuracoes/clinica/logo DELETE',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  })
}
