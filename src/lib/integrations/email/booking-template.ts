/**
 * Feature 017 — Templates HTML para emails de booking público.
 *
 * Dois renderers:
 *   - renderPatientBookingHtml: enviado ao paciente (com data/hora local
 *     "horário de Brasília", link de cancelar, contato da clínica)
 *   - renderAdminBookingHtml: enviado aos admins (resumo + link interno)
 *
 * Sem PII em logs. HTML escape em qualquer campo dinâmico.
 */

export interface PatientBookingTemplateInput {
  patientName: string
  clinicName: string
  clinicPhone: string | null
  clinicAddress: string | null
  doctorName: string
  procedureName: string
  scheduledAt: Date
  /** TZ display label (ex.: "horário de Brasília") */
  timezoneLabel: string
  /** URL absoluta de cancelamento (com token raw). */
  cancelUrl: string
}

export interface AdminBookingTemplateInput {
  clinicName: string
  patientName: string
  doctorName: string
  procedureName: string
  scheduledAt: Date
  /** URL absoluta para abrir o appointment no dashboard. */
  dashboardUrl: string
}

function fmtBrasilia(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderPatientBookingHtml(x: PatientBookingTemplateInput): string {
  const when = fmtBrasilia(x.scheduledAt)
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 24px auto; padding: 0 16px; color: #0f172a;">
    <h2 style="color: #1C4F71;">Agendamento confirmado!</h2>
    <p>Olá <strong>${escapeHtml(x.patientName)}</strong>,</p>
    <p>Seu agendamento na <strong>${escapeHtml(x.clinicName)}</strong> foi confirmado.</p>

    <table style="border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Profissional:</td>
        <td style="padding: 6px 0;"><strong>${escapeHtml(x.doctorName)}</strong></td>
      </tr>
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Procedimento:</td>
        <td style="padding: 6px 0;">${escapeHtml(x.procedureName)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Data e hora:</td>
        <td style="padding: 6px 0;"><strong>${escapeHtml(when)}</strong> (${escapeHtml(x.timezoneLabel)})</td>
      </tr>
      ${
        x.clinicAddress
          ? `<tr><td style="padding: 6px 12px 6px 0; color: #64748b;">Endereço:</td><td style="padding: 6px 0;">${escapeHtml(x.clinicAddress)}</td></tr>`
          : ''
      }
      ${
        x.clinicPhone
          ? `<tr><td style="padding: 6px 12px 6px 0; color: #64748b;">Contato da clínica:</td><td style="padding: 6px 0;">${escapeHtml(x.clinicPhone)}</td></tr>`
          : ''
      }
    </table>

    <p>O arquivo anexo <code>consulta.ics</code> pode ser importado em qualquer calendário (Google, Apple, Outlook).</p>

    <p style="margin-top: 24px;">
      <a href="${escapeHtml(x.cancelUrl)}" style="color: #b91c1c; text-decoration: underline;">Cancelar agendamento</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px;" />
    <p style="color: #64748b; font-size: 12px;">
      Este email foi enviado por ${escapeHtml(x.clinicName)} via Clinni.
      Se você não solicitou este agendamento, ignore este email.
    </p>
  </body>
</html>`
}

export function renderAdminBookingHtml(x: AdminBookingTemplateInput): string {
  const when = fmtBrasilia(x.scheduledAt)
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 24px auto; padding: 0 16px; color: #0f172a;">
    <h2 style="color: #1C4F71;">Novo agendamento online</h2>
    <p>Um paciente acabou de agendar pela página pública da clínica.</p>

    <table style="border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Paciente:</td>
        <td style="padding: 6px 0;"><strong>${escapeHtml(x.patientName)}</strong></td>
      </tr>
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Profissional:</td>
        <td style="padding: 6px 0;">${escapeHtml(x.doctorName)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Procedimento:</td>
        <td style="padding: 6px 0;">${escapeHtml(x.procedureName)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Data e hora:</td>
        <td style="padding: 6px 0;"><strong>${escapeHtml(when)}</strong> (horário de Brasília)</td>
      </tr>
    </table>

    <p>
      <a href="${escapeHtml(x.dashboardUrl)}" style="background: #1C4F71; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; display: inline-block;">Abrir no dashboard</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px;" />
    <p style="color: #64748b; font-size: 12px;">
      Notificação automática do Clinni — agendamento via link público da clínica.
    </p>
  </body>
</html>`
}
