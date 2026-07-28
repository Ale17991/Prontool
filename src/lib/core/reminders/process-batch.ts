/**
 * Feature 018 — Orquestrador do ciclo do cron.
 *
 * Pipeline:
 *   1. SELECT tenants ativos (reminder_enabled=TRUE)
 *   2. Para cada tenant em paralelo (limit 5):
 *      - Resolver fuso (default America/Sao_Paulo)
 *      - Skip se fora da janela ou fim de semana off
 *      - Para cada offset: selectDueAppointments → empilha no buffer
 *      - Cap global em 200 itens (clarificação Q1)
 *   3. Promise.allSettled(buffer.map(sendOneReminder))
 *   4. UPDATE tenant_clinic_profile.reminder_last_run_at em cada tenant tocado
 *   5. Retornar contadores
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'
import { resolvePublicBaseUrl } from '@/lib/core/app-url'
import { sendOneReminder } from './send-one'
import { sendOneWhatsAppReminder } from './send-one-whatsapp'
import { isWhatsAppConnected, getDecryptedApiKey } from '@/lib/core/whatsapp/config'
import { enqueueWhatsAppReminder } from '@/lib/integrations/queue/qstash-client'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import { isQstashConfigured } from '@/lib/integrations/queue/qstash-client'
import { isWeekend, isWithinWindow, selectDueAppointments } from './select-due'
import type {
  EligibleAppointment,
  ProcessBatchResult,
  ReminderChannel,
  TenantReminderSettings,
} from './types'

const MAX_BATCH = 200
const MAX_TENANTS_PARALLEL = 5
const DEFAULT_TZ = 'America/Sao_Paulo'

/**
 * Feature 051 — segundos entre um envio de WhatsApp e o seguinte, POR CLÍNICA
 * (FR-013). Rajada é o que mais aumenta risco de bloqueio do número, e é a
 * única mitigação real disponível numa solução não-oficial.
 */
const WHATSAPP_SPACING_SECONDS = 4

/**
 * Sem QStash configurado (dev), o envio acontece inline. Aí o lote precisa ser
 * pequeno: o espaçamento roda dentro da própria função e estouraria o timeout.
 */
const WHATSAPP_INLINE_MAX = 10
const WHATSAPP_INLINE_SPACING_MS = 1000

interface BatchItem {
  eligible: EligibleAppointment
  settings: TenantReminderSettings
  offsetHours: number
  channel: ReminderChannel
  clinicName: string
  clinicPhone: string | null
  publicBookingUrl: string | null
  templateWhatsApp: string | null
}

export async function processBatch(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<ProcessBatchResult> {
  const t0 = Date.now()

  // 1. Tenants ativos com toda a config necessária.
  const tenantsRes = await supabase
    .from('tenant_clinic_profile')
    .select(
      `tenant_id, reminder_enabled, reminder_offsets_hours, reminder_send_weekends,
       reminder_window_start, reminder_window_end,
       reminder_template_subject, reminder_template_body,
       reminder_channels, reminder_whatsapp_fallback_email, reminder_template_whatsapp,
       phone, corporate_name, public_booking_slug, public_booking_enabled`,
    )
    .eq('reminder_enabled', true)

  if (tenantsRes.error) {
    logger.error(
      { errorCode: (tenantsRes.error as { code?: string }).code },
      'cron-load-tenants-failed',
    )
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      tenantsAffected: 0,
      durationMs: Date.now() - t0,
    }
  }

  const tenants = (tenantsRes.data ?? []) as Array<{
    tenant_id: string
    reminder_enabled: boolean
    reminder_offsets_hours: number[]
    reminder_send_weekends: boolean
    reminder_window_start: string
    reminder_window_end: string
    reminder_template_subject: string | null
    reminder_template_body: string | null
    reminder_channels: string[] | null
    reminder_whatsapp_fallback_email: boolean | null
    reminder_template_whatsapp: string | null
    phone: string | null
    corporate_name: string | null
    public_booking_slug: string | null
    public_booking_enabled: boolean | null
  }>

  if (tenants.length === 0) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      tenantsAffected: 0,
      durationMs: Date.now() - t0,
    }
  }

  // Buffer global compartilhado entre tenants — cap em MAX_BATCH.
  const buffer: BatchItem[] = []
  const tenantsTouched = new Set<string>()
  const appUrl = resolvePublicBaseUrl()

  // Itera tenants em chunks de MAX_TENANTS_PARALLEL.
  for (let i = 0; i < tenants.length; i += MAX_TENANTS_PARALLEL) {
    if (buffer.length >= MAX_BATCH) break
    const chunk = tenants.slice(i, i + MAX_TENANTS_PARALLEL)
    await Promise.all(
      chunk.map(async (t) => {
        if (buffer.length >= MAX_BATCH) return
        const tz = DEFAULT_TZ // fuso por tenant ainda não modelado; default global

        // Janela horária
        const windowStart = trimSeconds(t.reminder_window_start)
        const windowEnd = trimSeconds(t.reminder_window_end)
        if (!isWithinWindow(now, windowStart, windowEnd, tz)) return

        // Fim de semana
        if (!t.reminder_send_weekends && isWeekend(now, tz)) return

        const settings: TenantReminderSettings = {
          tenantId: t.tenant_id,
          timezone: tz,
          enabled: true,
          offsetsHours: t.reminder_offsets_hours,
          sendWeekends: t.reminder_send_weekends,
          windowStart,
          windowEnd,
          templateSubject: t.reminder_template_subject,
          templateBody: t.reminder_template_body,
          lastRunAt: null,
          channels: (t.reminder_channels?.length
            ? t.reminder_channels
            : ['email']) as ReminderChannel[],
          whatsappFallbackEmail: t.reminder_whatsapp_fallback_email ?? true,
          templateWhatsApp: t.reminder_template_whatsapp,
        }
        const clinicName = t.corporate_name ?? 'Clínica'
        const clinicPhone = t.phone
        const publicBookingUrl =
          t.public_booking_enabled === true && t.public_booking_slug
            ? `${appUrl}/agendar/${t.public_booking_slug}`
            : null

        // Feature 051 — canais habilitados. Default {email} preserva o
        // comportamento de quem já usava a 018 e nunca abriu a tela nova.
        const channels = ((t.reminder_channels?.length
          ? t.reminder_channels
          : ['email']) as ReminderChannel[]).filter((c) => c === 'email' || c === 'whatsapp')

        // FR-012 — a conexão é verificada UMA vez, antes do lote. Sem isso, uma
        // clínica com o número fora do ar geraria uma falha por paciente em vez
        // de uma ocorrência agregada, enchendo o histórico de ruído.
        let whatsappUsable = channels.includes('whatsapp')
        if (whatsappUsable) {
          whatsappUsable = await isWhatsAppConnected(supabase as never, t.tenant_id).catch(
            () => false,
          )
          if (!whatsappUsable) {
            logger.warn({ tenantId: t.tenant_id }, 'whatsapp-not-connected-skipping-channel')
            // FR-012 — UMA ocorrência agregada, não uma falha por paciente. O
            // dispatchAlert deduplica por (tenant, tipo, subject_ref) numa
            // janela de 1h, então ciclos seguidos não empilham alerta.
            await dispatchAlert({
              tenantId: t.tenant_id,
              type: 'integration_sync_failed',
              subjectRef: { provider: 'whatsapp', reason: 'not_connected' },
              detail: {
                provider: 'whatsapp',
                mensagem:
                  'O WhatsApp da clínica não está conectado. Os lembretes por WhatsApp não foram enviados neste ciclo.',
              },
            }).catch(() => {
              // Alerta é best-effort: não pode derrubar o ciclo de e-mail.
            })
          }
        }

        for (const offsetHours of t.reminder_offsets_hours) {
          if (buffer.length >= MAX_BATCH) break
          for (const channel of channels) {
            if (buffer.length >= MAX_BATCH) break
            const eligibleList = await selectDueAppointments(supabase, {
              tenantId: t.tenant_id,
              offsetHours,
              now,
              channel,
            })
            for (const eligible of eligibleList) {
              if (buffer.length >= MAX_BATCH) break

              // Fallback (US3): canal é WhatsApp, mas o paciente não tem
              // telefone (ou o número da clínica caiu). Avisar por e-mail é
              // melhor que não avisar ninguém.
              let effective: ReminderChannel = channel
              if (channel === 'whatsapp' && (!whatsappUsable || !eligible.patientPhone)) {
                const canFallback =
                  t.reminder_whatsapp_fallback_email !== false &&
                  !channels.includes('email') &&
                  Boolean(eligible.patientEmail)
                if (!canFallback) continue
                effective = 'email'
              }

              buffer.push({
                eligible,
                settings,
                offsetHours,
                channel: effective,
                clinicName,
                clinicPhone,
                publicBookingUrl,
                templateWhatsApp: t.reminder_template_whatsapp,
              })
            }
          }
        }
        tenantsTouched.add(t.tenant_id)
      }),
    )
  }

  // 3. Processa buffer em paralelo (Promise.allSettled — falha individual não bloqueia)
  let sent = 0
  let failed = 0
  let skipped = 0

  // E-mail continua saindo em paralelo: o provedor aguenta, e nenhum e-mail
  // "queima" o remetente do jeito que uma rajada de WhatsApp queima o número.
  const emailItems = buffer.filter((i) => i.channel === 'email')
  const whatsappItems = buffer.filter((i) => i.channel === 'whatsapp')

  const results = await Promise.allSettled(
    emailItems.map((item) =>
      sendOneReminder({
        supabase,
        eligible: item.eligible,
        settings: item.settings,
        offsetHours: item.offsetHours,
        isManual: false,
        clinicName: item.clinicName,
        clinicPhone: item.clinicPhone,
        publicBookingUrl: item.publicBookingUrl,
      }),
    ),
  )

  for (const r of results) {
    if (r.status === 'rejected') {
      failed++
      continue
    }
    const rec = r.value
    if (!rec) {
      // Conflito de idempotência — não conta como processado.
      continue
    }
    if (rec.status === 'sent') sent++
    else if (rec.status === 'failed') failed++
    else skipped++
  }

  // WhatsApp vai ESPAÇADO (FR-013). O contador por tenant garante que o
  // espaçamento é por clínica: duas clínicas não precisam esperar uma à outra,
  // porque quem arrisca bloqueio é cada número isoladamente.
  const queuedPerTenant = new Map<string, number>()
  for (const item of isQstashConfigured() ? whatsappItems : []) {
    const tenantId = item.eligible.tenantId
    const idx = queuedPerTenant.get(tenantId) ?? 0
    queuedPerTenant.set(tenantId, idx + 1)

    const enq = await enqueueWhatsAppReminder({
      payload: {
        tenantId,
        eligible: item.eligible,
        settings: item.settings,
        offsetHours: item.offsetHours,
        clinicName: item.clinicName,
        clinicPhone: item.clinicPhone,
        publicBookingUrl: item.publicBookingUrl,
        templateWhatsApp: item.templateWhatsApp,
      },
      delaySeconds: idx * WHATSAPP_SPACING_SECONDS,
      traceId: `reminders-${tenantId}`,
    })
    // Enfileirado conta como processado; o desfecho real vira registro quando
    // o worker rodar. Sem messageId, o QStash não está configurado e o envio
    // inline abaixo assume.
    if (enq.messageId) sent++
  }

  // Degradação sem QStash (dev): envia inline, com lote pequeno e espaçamento
  // curto — o suficiente para exercitar o fluxo sem estourar o timeout.
  if (!isQstashConfigured() && whatsappItems.length > 0) {
    const inline = whatsappItems.slice(0, WHATSAPP_INLINE_MAX)
    if (whatsappItems.length > inline.length) {
      logger.warn(
        { total: whatsappItems.length, enviados: inline.length },
        'whatsapp-inline-batch-truncated',
      )
    }
    const abortedTenants = new Set<string>()
    for (const item of inline) {
      const tenantId = item.eligible.tenantId
      if (abortedTenants.has(tenantId)) {
        skipped++
        continue
      }
      const apiKey = await getDecryptedApiKey(supabase as never, tenantId).catch(() => null)
      if (!apiKey) {
        skipped++
        continue
      }
      const res = await sendOneWhatsAppReminder({
        supabase,
        eligible: item.eligible,
        settings: item.settings,
        offsetHours: item.offsetHours,
        isManual: false,
        clinicName: item.clinicName,
        clinicPhone: item.clinicPhone,
        publicBookingUrl: item.publicBookingUrl,
        templateWhatsApp: item.templateWhatsApp,
        apiKey,
      })
      // FR-012: número caiu no meio do lote — para de tentar por esta clínica
      // em vez de gerar uma falha por paciente.
      if (res.abortBatch) abortedTenants.add(tenantId)
      const st = res.record?.status
      if (st === 'sent') sent++
      else if (st === 'failed') failed++
      else if (st) skipped++
      await new Promise((r) => setTimeout(r, WHATSAPP_INLINE_SPACING_MS))
    }
  }

  // 4. UPDATE last_run_at por tenant tocado (best-effort)
  if (tenantsTouched.size > 0) {
    const nowIso = new Date().toISOString()
    await Promise.allSettled(
      Array.from(tenantsTouched).map((tenantId) =>
        supabase
          .from('tenant_clinic_profile')
          .update({ reminder_last_run_at: nowIso })
          .eq('tenant_id', tenantId),
      ),
    )
  }

  const durationMs = Date.now() - t0
  return {
    processed: sent + failed + skipped,
    sent,
    failed,
    skipped,
    tenantsAffected: tenantsTouched.size,
    durationMs,
  }
}

function trimSeconds(t: string | null | undefined): string {
  if (!t) return '08:00'
  return t.length >= 5 ? t.slice(0, 5) : t
}
