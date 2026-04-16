import { Resend } from 'resend'
import { logger } from '@/lib/observability/logger'

let resendSingleton: Resend | null = null

function getResend(): Resend {
  if (resendSingleton) return resendSingleton
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY missing')
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
  const from = process.env.RESEND_FROM ?? 'alertas@dev.homio.com.br'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const html = renderAlertHtml({
    subject: input.subject,
    bodyMarkdown: input.bodyMarkdown,
    dashboardUrl: new URL(input.dashboardUrl, appUrl).toString(),
  })

  try {
    const res = await getResend().emails.send({
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

function renderAlertHtml(x: { subject: string; bodyMarkdown: string; dashboardUrl: string }): string {
  // Very deliberate: no dynamic PII-bearing fields rendered here.
  const escaped = escapeHtml(x.bodyMarkdown)
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 24px auto; padding: 0 16px;">
    <h2 style="color: #b91c1c;">${escapeHtml(x.subject)}</h2>
    <pre style="white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 6px;">${escaped}</pre>
    <p><a href="${escapeHtml(x.dashboardUrl)}" style="background: #2563eb; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; display: inline-block;">Abrir no dashboard</a></p>
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
