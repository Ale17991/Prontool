/**
 * Feature 018 — Envia 1 lembrete: persiste registro queued → faz send → atualiza terminal.
 *
 * Pipeline:
 *   1. INSERT appointment_reminders (queued) com ON CONFLICT DO NOTHING (idempotência)
 *   2. Se conflito (já existe), early return null
 *   3. Re-valida JIT: opt-in, doctor active, email não-nulo
 *   4. Decrypt email + nome do paciente via RPC `get_patient_for_tenant`
 *   5. Renderiza template
 *   6. Chama Resend (sendBookingEmail)
 *   7. UPDATE status terminal (sent / failed / skipped_*)
 *
 * LGPD: email só existe in-memory entre passo 4 e passo 6. Nunca é
 * logado (Pino redact + cuidado manual). Erros logam apenas codes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'
import { sendBookingEmail } from '@/lib/integrations/email/resend-client'
import { renderReminderEmail } from './render-email'
import type {
  EligibleAppointment,
  ReminderRecord,
  ReminderStatus,
  TenantReminderSettings,
} from './types'

export interface SendOneInput {
  supabase: SupabaseClient
  eligible: EligibleAppointment
  settings: TenantReminderSettings
  /** Antecedência aplicada (-1 = manual). */
  offsetHours: number
  /** TRUE quando admin clicou "Reenviar manualmente" (Q2). */
  isManual: boolean
  /** Nome da clínica para placeholders. */
  clinicName: string
  /** Telefone da clínica para fallback de cancelamento (Q3 nível 3). */
  clinicPhone: string | null
  /** URL pública (`/agendar/[slug]`) se feature 017 habilitada (Q3 nível 2). */
  publicBookingUrl: string | null
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

export async function sendOneReminder(input: SendOneInput): Promise<ReminderRecord | null> {
  const { supabase, eligible, offsetHours, isManual } = input

  // 1. INSERT queued. Para cron (is_manual=FALSE) protege idempotência via
  //    UNIQUE partial; conflito → skip silencioso. Manual NUNCA dá conflito.
  const insertRes = await supabase
    .from('appointment_reminders')
    .insert({
      tenant_id: eligible.tenantId,
      appointment_id: eligible.appointmentId,
      scheduled_offset_hours: offsetHours,
      channel: 'email',
      status: 'queued',
      is_manual: isManual,
    })
    .select(
      'id, status, created_at, tenant_id, appointment_id, channel, scheduled_offset_hours, is_manual',
    )
    .maybeSingle()

  if (insertRes.error) {
    const code = (insertRes.error as { code?: string }).code
    if (code === '23505' && !isManual) {
      logger.info(
        { appointmentId: eligible.appointmentId, offsetHours },
        'reminder-already-queued-skipping',
      )
      return null
    }
    logger.error(
      { appointmentId: eligible.appointmentId, offsetHours, errorCode: code },
      'reminder-insert-queued-failed',
    )
    return null
  }

  if (!insertRes.data) {
    logger.warn({ appointmentId: eligible.appointmentId, offsetHours }, 'reminder-insert-no-data')
    return null
  }

  const reminderId = (insertRes.data as { id: string }).id

  async function finalize(
    status: ReminderStatus,
    extra: { error?: string; providerMessageId?: string } = {},
  ): Promise<ReminderRecord> {
    const updatePayload: Record<string, unknown> = { status }
    if (status === 'sent') updatePayload.sent_at = new Date().toISOString()
    if (extra.error) updatePayload.error = extra.error.slice(0, 500)
    if (extra.providerMessageId) updatePayload.provider_message_id = extra.providerMessageId

    const upd = await supabase
      .from('appointment_reminders')
      .update(updatePayload)
      .eq('id', reminderId)
      .select('*')
      .single()

    if (upd.error || !upd.data) {
      logger.error(
        { reminderId, status, errorCode: (upd.error as { code?: string } | null)?.code },
        'reminder-finalize-failed',
      )
    }
    return mapToRecord(upd.data ?? insertRes.data, { status, ...extra })
  }

  // 2. Re-valida JIT
  if (!eligible.remindersOptIn) return finalize('skipped_opt_out')
  if (!eligible.doctorActive) return finalize('skipped_doctor_inactive')
  if (!eligible.patientEmail) return finalize('skipped_no_email')

  // 3. Decrypt nome + email via RPC `get_patient_for_tenant` (service-role only)
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    return finalize('failed', { error: 'PATIENT_DATA_ENCRYPTION_KEY missing' })
  }

  const decryptRes = await supabase.rpc('get_patient_for_tenant', {
    p_tenant_id: eligible.tenantId,
    p_patient_id: eligible.patientId,
    p_key: key,
  })
  if (decryptRes.error || !decryptRes.data) {
    return finalize('failed', { error: 'decrypt-patient-failed' })
  }
  const decrypted = Array.isArray(decryptRes.data) ? decryptRes.data[0] : decryptRes.data
  const patient = decrypted as {
    full_name: string | null
    email: string | null
  } | null
  if (!patient?.email) return finalize('skipped_no_email')

  // 4. Renderiza template
  const placeholders = {
    paciente: patient.full_name ?? '—',
    medico: eligible.doctorFullName,
    procedimento: eligible.procedureName,
    horario: formatBrasilia(eligible.appointmentAt),
    clinica: input.clinicName,
  }
  const rendered = renderReminderEmail({
    template: {
      subject: input.settings.templateSubject,
      body: input.settings.templateBody,
    },
    placeholders,
    publicBookingUrl: input.publicBookingUrl,
    clinicPhone: input.clinicPhone,
  })

  // 5. Resend
  try {
    const sendResult = await sendBookingEmail({
      tenantId: eligible.tenantId,
      to: patient.email,
      subject: rendered.subject,
      html: rendered.html,
    })
    if (sendResult.id) {
      return finalize('sent', { providerMessageId: sendResult.id })
    }
    // sendBookingEmail retorna {id:null} quando RESEND_API_KEY ausente OU
    // falha do provider — não distingue. Tratamos como sent quando há id.
    // Sem id em dev: marcamos sent mesmo assim (motor funciona conceptualmente).
    if (!process.env.RESEND_API_KEY) {
      return finalize('sent', { providerMessageId: 'dev-bypass' })
    }
    return finalize('failed', { error: 'provider-returned-null-id' })
  } catch (err) {
    return finalize('failed', {
      error: err instanceof Error ? err.message : 'unknown-send-error',
    })
  }
}

function mapToRecord(row: unknown, override: Partial<ReminderRecord> = {}): ReminderRecord {
  const r = (row ?? {}) as Record<string, unknown>
  return {
    id: (r.id as string) ?? '',
    tenantId: (r.tenant_id as string) ?? '',
    appointmentId: (r.appointment_id as string) ?? '',
    scheduledOffsetHours: (r.scheduled_offset_hours as number) ?? 0,
    channel: ((r.channel as string) ?? 'email') as ReminderRecord['channel'],
    status: ((r.status as string) ?? 'queued') as ReminderStatus,
    error: (r.error as string | null) ?? null,
    providerMessageId: (r.provider_message_id as string | null) ?? null,
    isManual: (r.is_manual as boolean) ?? false,
    createdAt: (r.created_at as string) ?? new Date().toISOString(),
    sentAt: (r.sent_at as string | null) ?? null,
    ...override,
  }
}
