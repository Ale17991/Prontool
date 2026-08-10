/**
 * Feature 051 — Envia UM lembrete pelo canal WhatsApp.
 *
 * Espelha `send-one.ts` (e-mail) no formato, mas o desfecho de cada falha é
 * diferente: uma falha de e-mail é só daquele paciente, enquanto "número da
 * clínica desconectado" invalida o lote inteiro (FR-012).
 *
 * LGPD: o telefone em claro existe só entre a RPC de decrypt e a chamada ao
 * serviço. Nunca é logado, nunca é persistido fora do cadastro cifrado.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'
import { isSendablePhone, normalizePhone } from '@/lib/core/whatsapp/phone'
import { sendText } from '@/lib/core/whatsapp/service-client'
import { renderReminderWhatsApp } from './render-whatsapp'
import type {
  EligibleAppointment,
  ReminderRecord,
  ReminderStatus,
  TenantReminderSettings,
} from './types'

export interface SendOneWhatsAppInput {
  supabase: SupabaseClient
  eligible: EligibleAppointment
  settings: TenantReminderSettings
  offsetHours: number
  isManual: boolean
  clinicName: string
  clinicPhone: string | null
  publicBookingUrl: string | null
  /** Template texto puro da clínica; null usa o default. */
  templateWhatsApp: string | null
  /** `api_key` já decifrada pelo orquestrador — uma vez por lote, não por envio. */
  apiKey: string
}

/**
 * Além do registro, devolve se o LOTE deve parar. Só um motivo justifica
 * abortar: o número da clínica caiu no meio do caminho — insistir geraria uma
 * falha por paciente em vez da ocorrência agregada que o FR-012 exige.
 */
export interface SendOneWhatsAppResult {
  record: ReminderRecord | null
  abortBatch: boolean
}

function formatBrasilia(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export async function sendOneWhatsAppReminder(
  input: SendOneWhatsAppInput,
): Promise<SendOneWhatsAppResult> {
  const { supabase, eligible, offsetHours, isManual } = input

  // 1. INSERT queued. O índice parcial da 0094 discrimina por canal, então
  //    isto NÃO colide com o registro de e-mail do mesmo agendamento/offset.
  //    Reenvio manual (is_manual=TRUE) nunca é barrado — FR-027.
  const insertRes = await supabase
    .from('appointment_reminders')
    .insert({
      tenant_id: eligible.tenantId,
      appointment_id: eligible.appointmentId,
      scheduled_offset_hours: offsetHours,
      channel: 'whatsapp',
      status: 'queued',
      is_manual: isManual,
    })
    .select('id, status, created_at, tenant_id, appointment_id, channel, scheduled_offset_hours, is_manual')
    .maybeSingle()

  if (insertRes.error) {
    const code = (insertRes.error as { code?: string }).code
    if (code === '23505' && !isManual) {
      logger.info({ appointmentId: eligible.appointmentId, offsetHours }, 'whatsapp-reminder-already-queued')
      return { record: null, abortBatch: false }
    }
    logger.error(
      { appointmentId: eligible.appointmentId, offsetHours, errorCode: code },
      'whatsapp-reminder-insert-failed',
    )
    return { record: null, abortBatch: false }
  }
  if (!insertRes.data) return { record: null, abortBatch: false }

  const reminderId = (insertRes.data as { id: string }).id

  async function finalize(
    status: ReminderStatus,
    extra: { error?: string; providerMessageId?: string } = {},
  ): Promise<ReminderRecord> {
    const payload: Record<string, unknown> = { status }
    if (status === 'sent') payload.sent_at = new Date().toISOString()
    if (extra.error) payload.error = extra.error.slice(0, 500)
    if (extra.providerMessageId) payload.provider_message_id = extra.providerMessageId

    const upd = await supabase
      .from('appointment_reminders')
      .update(payload)
      .eq('id', reminderId)
      .select('*')
      .single()
    if (upd.error) {
      logger.error({ reminderId, status }, 'whatsapp-reminder-finalize-failed')
    }
    return mapToRecord(upd.data ?? insertRes.data, { status, ...extra })
  }

  // 2. Revalidação JIT. A ordem importa: recusa antes de ausência de dado, para
  //    o histórico dizer "ele não quis" e não "faltou telefone".
  if (!eligible.remindersOptIn) return { record: await finalize('skipped_opt_out'), abortBatch: false }
  if (!eligible.remindersWhatsappOptIn) {
    return { record: await finalize('skipped_opt_out_channel'), abortBatch: false }
  }
  if (!eligible.doctorActive) {
    return { record: await finalize('skipped_doctor_inactive'), abortBatch: false }
  }
  if (!eligible.patientPhone) return { record: await finalize('skipped_no_phone'), abortBatch: false }

  // 3. Decrypt de nome + telefone. Mesma RPC que o e-mail já usa.
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    return { record: await finalize('failed', { error: 'PATIENT_DATA_ENCRYPTION_KEY missing' }), abortBatch: false }
  }
  const dec = await supabase.rpc('get_patient_for_tenant', {
    p_tenant_id: eligible.tenantId,
    p_patient_id: eligible.patientId,
    p_key: key,
  })
  if (dec.error || !dec.data) {
    return { record: await finalize('failed', { error: 'decrypt-patient-failed' }), abortBatch: false }
  }
  const decrypted = Array.isArray(dec.data) ? dec.data[0] : dec.data
  const patient = decrypted as { full_name: string | null; phone: string | null } | null

  // Telefone existe mas é inválido (8 dígitos truncado, lixo digitado). Vira
  // `skipped_no_phone` e não `failed`: não há nada a re-tentar, e a recepção
  // precisa entender que o cadastro é que está errado.
  if (!patient?.phone || !isSendablePhone(patient.phone)) {
    return { record: await finalize('skipped_no_phone'), abortBatch: false }
  }
  const to = normalizePhone(patient.phone)

  // 4. Renderiza e envia.
  const message = renderReminderWhatsApp({
    template: input.templateWhatsApp,
    placeholders: {
      paciente: patient.full_name ?? '—',
      medico: eligible.doctorFullName,
      procedimento: eligible.procedureName,
      horario: formatBrasilia(eligible.appointmentAt),
      clinica: input.clinicName,
    },
    publicBookingUrl: input.publicBookingUrl,
    clinicPhone: input.clinicPhone,
  })

  // `externalId` = id do lembrete: fecha a idempotência ponta a ponta (D6).
  // Se a resposta se perder na rede, a retentativa não duplica a mensagem.
  const result = await sendText({ apiKey: input.apiKey, to, message, externalId: reminderId })

  if (result.ok) {
    // Desfecho indefinido (202) também entra como `sent`, e a escolha é
    // deliberada: o trigger de 0094 só aceita `queued → terminal`, então há que
    // cravar um dos dois. A evidência do primeiro envio real é que a mensagem
    // SAI — o que falhou foi esperar a resposta. Marcar `failed` mandaria a
    // recepção ligar para um paciente que já foi avisado; marcar `sent` no
    // caso raro em que não saiu deixa o lembrete sem nenhuma confirmação de
    // entrega, que é justamente o que a trilha de eventos mostra.
    const indefinido = 'indefinido' in result
    return {
      record: await finalize('sent', {
        providerMessageId: result.providerMessageId,
        ...(indefinido ? { error: 'envio-indefinido: timeout do serviço, aguardando confirmação' } : {}),
      }),
      abortBatch: false,
    }
  }

  if (result.kind === 'no_connection') {
    // FR-012: o número caiu. Não é falha deste paciente — é do lote inteiro.
    return { record: await finalize('skipped_no_connection'), abortBatch: true }
  }

  return { record: await finalize('failed', { error: `${result.kind}: ${result.detail}` }), abortBatch: false }
}

function mapToRecord(row: unknown, override: Partial<ReminderRecord> = {}): ReminderRecord {
  const r = (row ?? {}) as Record<string, unknown>
  return {
    id: (r.id as string) ?? '',
    tenantId: (r.tenant_id as string) ?? '',
    appointmentId: (r.appointment_id as string) ?? '',
    scheduledOffsetHours: (r.scheduled_offset_hours as number) ?? 0,
    channel: 'whatsapp',
    status: ((r.status as string) ?? 'queued') as ReminderStatus,
    error: (r.error as string | null) ?? null,
    providerMessageId: (r.provider_message_id as string | null) ?? null,
    isManual: (r.is_manual as boolean) ?? false,
    createdAt: (r.created_at as string) ?? new Date().toISOString(),
    sentAt: (r.sent_at as string | null) ?? null,
    ...override,
  }
}
