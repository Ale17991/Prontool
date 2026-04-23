import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { sendAlertEmail } from '@/lib/integrations/email/resend-client'
import { logger } from '@/lib/observability/logger'
import type { AlertType, Json } from '@/lib/db/types'

export interface DispatchAlertInput {
  tenantId: string
  type: AlertType
  subjectRef?: Record<string, unknown>
  detail: Record<string, unknown>
  /**
   * Dashboard path to include in the e-mail (relative; joined with
   * NEXT_PUBLIC_APP_URL). Defaults per-type if omitted.
   */
  dashboardPath?: string
}

const DEFAULT_PATH: Record<AlertType, string> = {
  dlq_event: '/dashboard/dlq',
  webhook_rejected: '/dashboard/alertas',
  tuss_deprecated: '/dashboard/procedimentos',
  signature_failure: '/dashboard/alertas',
  rbac_denied: '/dashboard/auditoria',
  ghl_sync_failed: '/dashboard/alertas',
}

const DEDUP_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export async function dispatchAlert(input: DispatchAlertInput): Promise<{ alertId: string; deduped: boolean }> {
  const supabase = createSupabaseServiceClient()

  // Dedup: if an open alert of the same (tenant, type, subject_ref) was
  // created in the last hour, reuse it instead of emitting a new one.
  const dedupSince = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()
  const existing = await supabase
    .from('alerts')
    .select('id, email_sent_to')
    .eq('tenant_id', input.tenantId)
    .eq('type', input.type)
    .eq('status', 'aberto')
    .gte('created_at', dedupSince)
    .contains('subject_ref', input.subjectRef ?? {})
    .maybeSingle()

  if (existing.data?.id) {
    logger.info(
      { tenantId: input.tenantId, type: input.type, alertId: existing.data.id },
      'alert-deduplicated',
    )
    return { alertId: existing.data.id, deduped: true }
  }

  const inserted = await supabase
    .from('alerts')
    .insert({
      tenant_id: input.tenantId,
      type: input.type,
      subject_ref: (input.subjectRef ?? {}) as Json,
      detail: input.detail as Json,
      status: 'aberto',
    })
    .select('id')
    .single()

  if (inserted.error || !inserted.data) {
    throw new Error(`alert insert failed: ${inserted.error?.message}`)
  }
  const alertId = inserted.data.id

  await supabase.from('alert_status_transitions').insert({
    tenant_id: input.tenantId,
    alert_id: alertId,
    from_status: null,
    to_status: 'aberto',
    reason: 'auto-created',
  })

  // Lookup admin e-mails for the tenant.
  const admins = await supabase
    .from('user_tenants')
    .select('user_id')
    .eq('tenant_id', input.tenantId)
    .eq('role', 'admin')

  const adminIds = (admins.data ?? []).map((r) => r.user_id)
  if (adminIds.length === 0) {
    logger.warn({ tenantId: input.tenantId, type: input.type }, 'no-admins-to-notify')
    return { alertId, deduped: false }
  }

  const users = await supabase.auth.admin.listUsers()
  const toEmails = (users.data?.users ?? [])
    .filter((u) => adminIds.includes(u.id) && u.email)
    .map((u) => u.email as string)

  if (toEmails.length > 0) {
    const path = input.dashboardPath ?? DEFAULT_PATH[input.type]
    await sendAlertEmail({
      tenantId: input.tenantId,
      to: toEmails,
      subject: subjectFor(input.type),
      bodyMarkdown: renderSafeDetail(input.type, input.detail),
      dashboardUrl: path,
    })

    await supabase
      .from('alerts')
      .update({
        email_sent_to: toEmails,
        email_last_sent_at: new Date().toISOString(),
      })
      .eq('id', alertId)
  }

  return { alertId, deduped: false }
}

function subjectFor(type: AlertType): string {
  switch (type) {
    case 'dlq_event': return '[Pronttu] Evento do GHL aguardando correção'
    case 'webhook_rejected': return '[Pronttu] Webhook GHL rejeitado'
    case 'tuss_deprecated': return '[Pronttu] Código TUSS descontinuado em uso'
    case 'signature_failure': return '[Pronttu] Falha de assinatura em webhook'
    case 'rbac_denied': return '[Pronttu] Tentativa de acesso negada'
    case 'ghl_sync_failed': return '[Pronttu] Contato não sincronizado com o GHL'
  }
}

/** Whitelist approach: only known non-PII keys are rendered in e-mail body. */
function renderSafeDetail(type: AlertType, detail: Record<string, unknown>): string {
  const SAFE_KEYS = new Set([
    'event_id', 'raw_event_id', 'ghl_event_id', 'procedure_id', 'plan_id',
    'doctor_identifier', 'tuss_code', 'failure_reason', 'attempt_count',
    'route', 'role', 'action', 'timestamp',
  ])
  const lines: string[] = [`Tipo: ${type}`]
  for (const [k, v] of Object.entries(detail)) {
    if (SAFE_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      lines.push(`${k}: ${String(v)}`)
    }
  }
  lines.push('')
  lines.push('Detalhes completos disponíveis no dashboard (autenticação requerida).')
  return lines.join('\n')
}
