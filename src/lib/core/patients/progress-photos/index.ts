import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { sniffImageType } from '@/lib/utils/image-magic-bytes'
import { createSignedUrlOrNull } from '@/lib/core/storage/signed-url'
import {
  PHOTO_ANGLES,
  buildSeries,
  type AngleSeries,
  type PhotoAngle,
  type ProgressPhoto,
} from './compare'

export {
  PHOTO_ANGLES,
  PHOTO_ANGLE_LABEL,
  buildSeries,
  buildPairs,
  describeInterval,
} from './compare'
export type { PhotoAngle, ProgressPhoto, PhotoPair, AngleSeries } from './compare'

export const PROGRESS_PHOTO_BUCKET = 'patient-progress-photos' as const
export const MAX_PROGRESS_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB
/**
 * TTL longo de propósito: a tela abre a galeria inteira de uma vez, e uma URL
 * que vence no meio da consulta transforma a comparação em quadrado cinza.
 */
const SIGNED_TTL_SECONDS = 60 * 60 * 12 // 12 h

function isAngle(value: unknown): value is PhotoAngle {
  return typeof value === 'string' && (PHOTO_ANGLES as readonly string[]).includes(value)
}

/** `YYYY-MM-DD` — a coluna é DATE e não aceita instante. */
function isYmd(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export interface UploadProgressPhotoInput {
  tenantId: string
  patientId: string
  actorUserId: string
  file: { arrayBuffer(): Promise<ArrayBuffer>; size: number }
  angle: unknown
  takenOn: unknown
  note?: unknown
}

export async function uploadProgressPhoto(
  supabase: SupabaseClient<Database>,
  input: UploadProgressPhotoInput,
): Promise<ProgressPhoto> {
  if (input.file.size > MAX_PROGRESS_PHOTO_BYTES) {
    throw new ValidationError('Foto excede 8 MB.', {
      reason: 'payload_too_large',
      size: input.file.size,
    })
  }
  if (!isAngle(input.angle)) {
    throw new ValidationError('Ângulo inválido.', { reason: 'invalid_angle' })
  }
  if (!isYmd(input.takenOn)) {
    throw new ValidationError('Informe a data da foto (AAAA-MM-DD).', { reason: 'invalid_date' })
  }
  const note =
    typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null

  const buffer = await input.file.arrayBuffer()
  const sniffed = sniffImageType(buffer)
  if (!sniffed) {
    throw new ValidationError('Apenas imagens JPG ou PNG.', { reason: 'invalid_image_format' })
  }

  // Nome aleatório, nunca o do arquivo: o nome que sai da câmera do celular
  // não é confiável e o path é o que a RLS de storage lê.
  const path = `${input.tenantId}/${input.patientId}/${randomUUID()}.${sniffed}`
  const contentType = sniffed === 'png' ? 'image/png' : 'image/jpeg'

  const { error: upErr } = await supabase.storage
    .from(PROGRESS_PHOTO_BUCKET)
    .upload(path, buffer, { upsert: false, contentType })
  if (upErr) throw new Error(`uploadProgressPhoto storage failed: ${upErr.message}`)

  const { data, error } = await supabase
    .from('patient_progress_photos' as never)
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      storage_path: path,
      angle: input.angle,
      taken_on: input.takenOn,
      note,
      content_type: contentType,
      file_size_bytes: input.file.size,
      uploaded_by: input.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error) {
    // Sem isto o objeto fica órfão no bucket, contando espaço e sem nenhuma
    // linha que o alcance para apagar depois.
    await supabase.storage.from(PROGRESS_PHOTO_BUCKET).remove([path])
    throw new Error(`uploadProgressPhoto insert failed: ${error.message}`)
  }

  await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: null,
    entity: 'patient_progress_photos',
    entity_id: (data as { id: string }).id,
    field: 'foto_evolucao',
    old_value: null,
    new_value: `${input.angle} · ${input.takenOn}`,
    reason: 'foto de evolução enviada via /api/pacientes/[id]/fotos-evolucao POST',
    result: 'success',
  } as never)

  const signedUrl = await createSignedUrlOrNull(
    supabase,
    PROGRESS_PHOTO_BUCKET,
    path,
    SIGNED_TTL_SECONDS,
  )
  return {
    id: (data as { id: string }).id,
    angle: input.angle,
    takenOn: input.takenOn,
    note,
    signedUrl,
  }
}

interface PhotoRow {
  id: string
  angle: string
  taken_on: string
  note: string | null
  storage_path: string
}

/**
 * A coleção do paciente, já com URL assinada. Assina em paralelo — em série,
 * uma galeria de trinta fotos somava trinta viagens ao storage antes de a
 * página aparecer.
 */
export async function listProgressPhotos(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<ProgressPhoto[]> {
  const { data, error } = await supabase
    .from('patient_progress_photos' as never)
    .select('id, angle, taken_on, note, storage_path')
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .is('deleted_at', null)
    .order('taken_on', { ascending: true })
  if (error) throw new Error(`listProgressPhotos failed: ${error.message}`)

  const rows = (data ?? []) as unknown as PhotoRow[]
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      angle: (isAngle(row.angle) ? row.angle : 'outro') as PhotoAngle,
      takenOn: row.taken_on,
      note: row.note,
      signedUrl: await createSignedUrlOrNull(
        supabase,
        PROGRESS_PHOTO_BUCKET,
        row.storage_path,
        SIGNED_TTL_SECONDS,
      ),
    })),
  )
}

export async function getProgressSeries(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<AngleSeries[]> {
  return buildSeries(await listProgressPhotos(supabase, args))
}

/**
 * Exclusão é SOFT e o arquivo FICA no bucket. Foto clínica apagada por engano
 * não se refaz — o paciente teria que voltar ao estado de seis meses atrás — e
 * o registro de que ela existiu é o que permite explicar uma comparação que
 * mudou. Quem precisa sumir de verdade passa pela anonimização do paciente.
 */
export async function deleteProgressPhoto(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; photoId: string; actorUserId: string },
): Promise<void> {
  const { data, error } = await supabase
    .from('patient_progress_photos' as never)
    .update({ deleted_at: new Date().toISOString(), deleted_by: args.actorUserId } as never)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .eq('id', args.photoId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`deleteProgressPhoto failed: ${error.message}`)
  if (!data) throw new ValidationError('Foto não encontrada.', { reason: 'not_found' })

  await supabase.from('audit_log').insert({
    tenant_id: args.tenantId,
    actor_id: args.actorUserId,
    actor_label: null,
    entity: 'patient_progress_photos',
    entity_id: args.photoId,
    field: 'foto_evolucao',
    old_value: 'ativa',
    new_value: null,
    reason: 'foto de evolução removida via /api/pacientes/[id]/fotos-evolucao/[photoId] DELETE',
    result: 'success',
  } as never)
}
