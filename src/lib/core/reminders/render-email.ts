/**
 * Feature 018 — Renderiza email de lembrete com substituição de placeholders.
 *
 * Pipeline:
 *   1. Pega template (custom do tenant ou default)
 *   2. Escapa HTML em CADA valor de placeholder (defesa XSS)
 *   3. Substitui {{key}} → valor escapado
 *   4. Anexa, no rodapé do corpo, link/instrução de cancelamento (Q3)
 *
 * Defesa XSS: o template pode vir do admin (textarea). NÃO é confiável.
 * Mas o conteúdo do template é renderizado AS-IS (admin é responsável pelo
 * HTML que cola). Apenas os VALORES substituídos (paciente, médico, etc)
 * são escapados — vêm de dados do banco e podem conter `<`, `>`, `&`.
 */

import {
  getDefaultReminderBody,
  getDefaultReminderSubject,
} from '@/lib/integrations/email/reminder-template'
import type {
  RenderedReminderEmail,
  ReminderRenderInput,
  ReminderTemplatePlaceholders,
} from './types'

const PLACEHOLDER_KEYS: ReadonlyArray<keyof ReminderTemplatePlaceholders> = [
  'paciente',
  'medico',
  'procedimento',
  'horario',
  'clinica',
]

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function substitute(template: string, placeholders: ReminderTemplatePlaceholders): string {
  let out = template
  for (const key of PLACEHOLDER_KEYS) {
    const value = escapeHtml(placeholders[key])
    // Substitui TODAS as ocorrências de {{key}} (case-insensitive seria
    // fonte de surpresa; mantemos sensitive para consistência com a UI).
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g')
    out = out.replace(pattern, value)
  }
  return out
}

/**
 * Constrói o rodapé com link de cancelamento conforme Q3:
 *   - Nível 1: token público (se 017 + slug habilitado) — TODO Fase 2 (depende de
 *     extensão da 017 para emitir tokens em agendamentos internos)
 *   - Nível 2: link para landing pública da clínica (se feature 017 habilitada
 *     e slug definido)
 *   - Nível 3: telefone textual
 */
function buildCancelFooter(input: ReminderRenderInput): string {
  if (input.publicBookingUrl) {
    return `<p style="margin-top: 16px; color: #475569; font-size: 13px;">
  Caso precise <a href="${escapeHtml(input.publicBookingUrl)}" style="color: #1C4F71;">cancelar ou reagendar</a>,
  entre em contato com a clínica.
</p>`
  }
  if (input.clinicPhone) {
    return `<p style="margin-top: 16px; color: #475569; font-size: 13px;">
  Caso precise cancelar ou reagendar, entre em contato com a clínica:
  <strong>${escapeHtml(input.clinicPhone)}</strong>
</p>`
  }
  return `<p style="margin-top: 16px; color: #475569; font-size: 13px;">
  Caso precise cancelar ou reagendar, entre em contato com a clínica.
</p>`
}

export function renderReminderEmail(input: ReminderRenderInput): RenderedReminderEmail {
  const subjectTemplate = input.template.subject ?? getDefaultReminderSubject()
  const bodyTemplate = input.template.body ?? getDefaultReminderBody()

  const subject = substitute(subjectTemplate, input.placeholders)
  let html = substitute(bodyTemplate, input.placeholders)

  // Anexa footer de cancelamento ANTES do </body> se possível, senão concatena.
  const footer = buildCancelFooter(input)
  if (html.includes('</body>')) {
    html = html.replace('</body>', `${footer}\n</body>`)
  } else {
    html = `${html}\n${footer}`
  }

  return { subject, html }
}
