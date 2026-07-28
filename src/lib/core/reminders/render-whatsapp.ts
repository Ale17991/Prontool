/**
 * Feature 051 — Renderiza o lembrete para o canal WhatsApp.
 *
 * Irmão de `render-email.ts`, mas produz TEXTO PURO. O template de e-mail não
 * serve aqui: ele é HTML, e o paciente receberia as tags literais no celular.
 * Por isso o canal tem template próprio (`reminder_template_whatsapp`) e, por
 * consequência, nenhum escape de HTML — escapar aqui faria o paciente ver
 * `&amp;` no meio do nome da clínica.
 *
 * FR-007a: a mensagem avisa que respostas não são lidas. Sem isso, o paciente
 * que responde "preciso remarcar" perde a consulta achando que avisou — e o
 * v1 não processa inbound (FR-026).
 */

import type { ReminderTemplatePlaceholders } from './types'

const PLACEHOLDER_KEYS: ReadonlyArray<keyof ReminderTemplatePlaceholders> = [
  'paciente',
  'medico',
  'procedimento',
  'horario',
  'clinica',
]

export interface WhatsAppRenderInput {
  /** Template da clínica; null usa o default do sistema. */
  template: string | null
  placeholders: ReminderTemplatePlaceholders
  /** Nível 1 do fallback de contato: link público de agendamento. */
  publicBookingUrl: string | null
  /** Nível 2: telefone da clínica. */
  clinicPhone: string | null
}

/** WhatsApp usa *asteriscos* para negrito — não HTML. */
const DEFAULT_TEMPLATE = `Olá, {{paciente}}! 👋

Passando para lembrar da sua consulta:

📅 *{{horario}}*
👩‍⚕️ {{medico}}
🩺 {{procedimento}}

Até lá! — {{clinica}}`

function substitute(template: string, p: ReminderTemplatePlaceholders): string {
  let out = template
  for (const key of PLACEHOLDER_KEYS) {
    out = out.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), p[key])
  }
  return out
}

/**
 * Rodapé de contato, mesma hierarquia de 3 níveis do e-mail (FR-007a), mais o
 * aviso de que a caixa não é lida. Em tom de parceria: o objetivo é o paciente
 * saber para onde ir, não sentir que levou uma porta na cara.
 */
function buildFooter(input: WhatsAppRenderInput): string {
  const aviso = 'Esta mensagem é automática e não conseguimos ler respostas por aqui.'
  if (input.publicBookingUrl) {
    return `${aviso}\nPara remarcar ou cancelar: ${input.publicBookingUrl}`
  }
  if (input.clinicPhone) {
    return `${aviso}\nPara remarcar ou cancelar, fale com a gente em ${input.clinicPhone}.`
  }
  return `${aviso}\nPara remarcar ou cancelar, entre em contato com a clínica.`
}

export function renderReminderWhatsApp(input: WhatsAppRenderInput): string {
  const body = substitute(input.template ?? DEFAULT_TEMPLATE, input.placeholders)
  return `${body.trimEnd()}\n\n${buildFooter(input)}`
}
