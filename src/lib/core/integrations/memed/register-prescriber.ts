import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getDoctor, type DoctorDetail } from '@/lib/core/doctors/get'
import { getMemedConnection } from './credentials'
import { memedFetch } from './client'
import { recordMemedAudit } from './audit'
import { MemedNotConnectedError, MemedPrescriberFieldsMissingError } from './errors'
import { memedPrescriberPayloadSchema, type MemedPrescriberPayload } from './types'

/**
 * Habilita um profissional como prescritor na Memed (Feature 026, US2).
 * Monta o payload a partir do cadastro do doctor, chama
 * `POST /sinapse-prescricao/usuarios` e faz upsert em `memed_prescribers`.
 */

export interface EnablePrescriberInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  doctorId: string
  /** ID da especialidade no catálogo Memed (de-para US4). Opcional. */
  memedSpecialtyId?: string | null
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface EnablePrescriberResult {
  status: 'registered'
  externalId: string
}

/** Divide `full_name` em nome (1ª palavra) + sobrenome (restante). */
function splitName(full: string): { nome: string; sobrenome: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) {
    const only = parts[0] ?? ''
    return { nome: only, sobrenome: only }
  }
  return { nome: parts[0]!, sobrenome: parts.slice(1).join(' ') }
}

/**
 * Valida os campos obrigatórios do prescritor e monta o payload da Memed.
 * Lança `MemedPrescriberFieldsMissingError` listando o que falta.
 */
export function buildPrescriberPayload(
  doctor: DoctorDetail,
  specialtyId?: string | null,
): MemedPrescriberPayload {
  const missing: string[] = []
  const cpfDigits = (doctor.cpf ?? '').replace(/\D/g, '')
  if (!doctor.fullName.trim()) missing.push('nome completo')
  if (cpfDigits.length !== 11) missing.push('CPF')
  if (!doctor.councilName) missing.push('conselho')
  if (!doctor.councilNumber) missing.push('número do conselho')
  if (!doctor.councilState || !/^[A-Za-z]{2}$/.test(doctor.councilState)) missing.push('UF do conselho')
  if (!doctor.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(doctor.birthDate)) missing.push('data de nascimento')
  if (missing.length > 0) throw new MemedPrescriberFieldsMissingError(missing)

  const { nome, sobrenome } = splitName(doctor.fullName)
  const [year, month, day] = doctor.birthDate!.split('-')

  return memedPrescriberPayloadSchema.parse({
    external_id: doctor.id,
    nome,
    sobrenome,
    cpf: cpfDigits,
    board: {
      board_code: doctor.councilName!,
      board_number: doctor.councilNumber!,
      board_state: doctor.councilState!.toUpperCase(),
    },
    data_nascimento: `${day}/${month}/${year}`,
    // De-para de especialidade (US4): enviado quando mapeado; sem mapeamento
    // o prescritor é registrado sem especialidade (não bloqueia).
    ...(specialtyId ? { especialidade: specialtyId } : {}),
  })
}

async function upsertPrescriber(
  supabase: SupabaseClient<Database>,
  row: {
    tenantId: string
    doctorId: string
    externalId: string
    status: 'pending' | 'registered' | 'error'
    lastError: string | null
    lastSyncedAt: string | null
    actorUserId: string
    memedSpecialtyId?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('memed_prescribers').upsert(
    {
      tenant_id: row.tenantId,
      doctor_id: row.doctorId,
      external_id: row.externalId,
      status: row.status,
      last_error: row.lastError,
      last_synced_at: row.lastSyncedAt,
      created_by_user_id: row.actorUserId,
      // Só inclui a coluna quando informada, para não sobrescrever um
      // mapeamento existente com null em re-habilitações sem especialidade.
      ...(row.memedSpecialtyId !== undefined ? { memed_specialty_id: row.memedSpecialtyId } : {}),
    },
    { onConflict: 'tenant_id,doctor_id' },
  )
  if (error) throw new Error(`upsertPrescriber failed: ${error.message}`)
}

export async function enablePrescriber(
  input: EnablePrescriberInput,
): Promise<EnablePrescriberResult> {
  const { supabase, tenantId, doctorId } = input

  const connection = await getMemedConnection(supabase, tenantId)
  if (!connection || !connection.connected) throw new MemedNotConnectedError()

  const doctor = await getDoctor(supabase, { tenantId, doctorId })
  const payload = buildPrescriberPayload(doctor, input.memedSpecialtyId)

  try {
    await memedFetch(connection.environment, connection.credentials, {
      method: 'POST',
      path: '/sinapse-prescricao/usuarios',
      body: { data: { type: 'usuarios', attributes: payload } },
    })
  } catch (err) {
    // Persiste o estado de erro e audita a tentativa antes de propagar.
    const message = err instanceof Error ? err.message : 'Falha ao registrar prescritor'
    await upsertPrescriber(supabase, {
      tenantId,
      doctorId,
      externalId: payload.external_id,
      status: 'error',
      lastError: message,
      lastSyncedAt: null,
      actorUserId: input.actorUserId,
      memedSpecialtyId: input.memedSpecialtyId,
    })
    await recordMemedAudit(supabase, {
      tenantId,
      actorUserId: input.actorUserId,
      actorLabel: input.actorLabel,
      entity: 'memed_prescribers',
      entityId: doctorId,
      field: 'memed.prescriber.enable',
      detail: { doctor_id: doctorId, status: 'error' },
      reason: 'falha ao habilitar prescritor na Memed',
      ip: input.ip,
      userAgent: input.userAgent,
      result: 'conflict',
    }).catch(() => {})
    throw err
  }

  await upsertPrescriber(supabase, {
    tenantId,
    doctorId,
    externalId: payload.external_id,
    status: 'registered',
    lastError: null,
    lastSyncedAt: new Date().toISOString(),
    actorUserId: input.actorUserId,
    memedSpecialtyId: input.memedSpecialtyId,
  })

  await recordMemedAudit(supabase, {
    tenantId,
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    entity: 'memed_prescribers',
    entityId: doctorId,
    field: 'memed.prescriber.enable',
    detail: { doctor_id: doctorId, status: 'registered' },
    reason: 'admin habilitou profissional como prescritor',
    ip: input.ip,
    userAgent: input.userAgent,
  })

  return { status: 'registered', externalId: payload.external_id }
}
