import { Resend } from 'resend'
import { logger } from '@/lib/observability/logger'

let resendSingleton: Resend | null = null

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

function getResend(key: string): Resend {
  if (resendSingleton) return resendSingleton
  resendSingleton = new Resend(key)
  return resendSingleton
}

export interface AlertEmailInput {
  tenantId: string
  to: string[]
  subject: string
  /**
   * Markdown-ish safe summary. MUST NOT contain PII. Patient references
   * use internal identifiers; the recipient follows the dashboard link to
   * see details behind authentication.
   */
  bodyMarkdown: string
  dashboardUrl: string
}

export async function sendAlertEmail(input: AlertEmailInput): Promise<{ id: string | null }> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    logger.warn(
      { tenantId: input.tenantId, subject: input.subject },
      'resend-not-configured-skipping-email',
    )
    return { id: null }
  }

  const from = process.env.RESEND_FROM ?? 'alertas@dev.prontool.io'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const html = renderAlertHtml({
    subject: input.subject,
    bodyMarkdown: input.bodyMarkdown,
    dashboardUrl: new URL(input.dashboardUrl, appUrl).toString(),
  })

  try {
    const res = await getResend(key).emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html,
    })
    return { id: res.data?.id ?? null }
  } catch (err) {
    logger.error({ err, tenantId: input.tenantId, subject: input.subject }, 'resend-send-failed')
    throw err
  }
}

// =========================================================================
// Feature 017 — Emails de booking público (paciente + admin)
// =========================================================================

export interface SendBookingEmailInput {
  tenantId: string
  to: string
  subject: string
  html: string
  attachments?: Array<{
    filename: string
    /** Conteúdo bruto (string utf-8 ou base64). */
    content: string
  }>
}

/**
 * Envia email com suporte a attachments. Usado pelo fluxo de booking
 * público (anexa .ics no email do paciente). Em ambiente sem RESEND_API_KEY
 * registra warning e retorna { id: null } — não joga.
 */
export async function sendBookingEmail(
  input: SendBookingEmailInput,
): Promise<{ id: string | null }> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    logger.warn(
      { tenantId: input.tenantId, subject: input.subject },
      'resend-not-configured-skipping-booking-email',
    )
    return { id: null }
  }

  const from = process.env.RESEND_FROM ?? 'agendamentos@dev.prontool.io'

  try {
    const res = await getResend(key).emails.send({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    })
    return { id: res.data?.id ?? null }
  } catch (err) {
    logger.error(
      { err, tenantId: input.tenantId, subject: input.subject },
      'resend-send-booking-failed',
    )
    // Não joga — emails são fire-and-forget no fluxo de booking.
    return { id: null }
  }
}

function renderAlertHtml(x: { subject: string; bodyMarkdown: string; dashboardUrl: string }): string {
  // Very deliberate: no dynamic PII-bearing fields rendered here.
  const escaped = escapeHtml(x.bodyMarkdown)
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 24px auto; padding: 0 16px;">
    <h2 style="color: #b91c1c;">${escapeHtml(x.subject)}</h2>
    <pre style="white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 6px;">${escaped}</pre>
    <p><a href="${escapeHtml(x.dashboardUrl)}" style="background: #1C4F71; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; display: inline-block;">Abrir no dashboard</a></p>
    <p style="color: #64748b; font-size: 12px;">Este e-mail não contém dados pessoais de pacientes. Os detalhes completos requerem autenticação no dashboard.</p>
  </body>
</html>`
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
