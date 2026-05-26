/**
 * Feature 018 — Template default do email de lembrete.
 *
 * Espelha o padrão de `booking-template.ts` (017): HTML inline-style,
 * responsivo, escape HTML aplicado pelo render-email.ts no caller.
 *
 * Placeholders disponíveis (substituídos por render-email.ts):
 *   {{paciente}}, {{medico}}, {{procedimento}}, {{horario}}, {{clinica}}
 */

export function getDefaultReminderSubject(): string {
  return 'Lembrete: sua consulta na {{clinica}}'
}

export function getDefaultReminderBody(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 24px auto; padding: 0 16px; color: #0f172a;">
    <h2 style="color: #1C4F71;">Lembrete de consulta</h2>
    <p>Olá <strong>{{paciente}}</strong>,</p>
    <p>Este é um lembrete da sua consulta na <strong>{{clinica}}</strong>.</p>

    <table style="border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Profissional:</td>
        <td style="padding: 6px 0;"><strong>{{medico}}</strong></td>
      </tr>
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Procedimento:</td>
        <td style="padding: 6px 0;">{{procedimento}}</td>
      </tr>
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #64748b;">Data e hora:</td>
        <td style="padding: 6px 0;"><strong>{{horario}}</strong> (horário de Brasília)</td>
      </tr>
    </table>

    <p style="color: #475569;">
      Caso precise reagendar ou cancelar, entre em contato com a clínica.
    </p>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px;" />
    <p style="color: #64748b; font-size: 12px;">
      Mensagem automática enviada pela {{clinica}} via Clinni. Se você não
      é o destinatário, ignore este email.
    </p>
  </body>
</html>`
}
