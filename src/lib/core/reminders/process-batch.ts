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
import { sendOneReminder } from './send-one'
import {
  isWeekend,
  isWithinWindow,
  selectDueAppointments,
} from './select-due'
import type {
  EligibleAppointment,
  ProcessBatchResult,
  TenantReminderSettings,
} from './types'

const MAX_BATCH = 200
const MAX_TENANTS_PARALLEL = 5
const DEFAULT_TZ = 'America/Sao_Paulo'

interface BatchItem {
  eligible: EligibleAppointment
  settings: TenantReminderSettings
  offsetHours: number
  clinicName: string
  clinicPhone: string | null
  publicBookingUrl: string | null
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
       phone, corporate_name, public_booking_slug, public_booking_enabled`,
    )
    .eq('reminder_enabled', true)

  if (tenantsRes.error) {
    logger.error({ errorCode: (tenantsRes.error as { code?: string }).code }, 'cron-load-tenants-failed')
    return { processed: 0, sent: 0, failed: 0, skipped: 0, tenantsAffected: 0, durationMs: Date.now() - t0 }
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
    phone: string | null
    corporate_name: string | null
    public_booking_slug: string | null
    public_booking_enabled: boolean | null
  }>

  if (tenants.length === 0) {
    return { processed: 0, sent: 0, failed: 0, skipped: 0, tenantsAffected: 0, durationMs: Date.now() - t0 }
  }

  // Buffer global compartilhado entre tenants — cap em MAX_BATCH.
  const buffer: BatchItem[] = []
  const tenantsTouched = new Set<string>()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'

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
        }
        const clinicName = t.corporate_name ?? 'Clínica'
        const clinicPhone = t.phone
        const publicBookingUrl =
          t.public_booking_enabled === true && t.public_booking_slug
            ? `${appUrl}/agendar/${t.public_booking_slug}`
            : null

        for (const offsetHours of t.reminder_offsets_hours) {
          if (buffer.length >= MAX_BATCH) break
          const eligibleList = await selectDueAppointments(supabase, {
            tenantId: t.tenant_id,
            offsetHours,
            now,
          })
          for (const eligible of eligibleList) {
            if (buffer.length >= MAX_BATCH) break
            buffer.push({
              eligible,
              settings,
              offsetHours,
              clinicName,
              clinicPhone,
              publicBookingUrl,
            })
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

  const results = await Promise.allSettled(
    buffer.map((item) =>
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
