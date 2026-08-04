/**
 * Feature 053 — a decisão de consentimento e canal, isolada e pura.
 *
 * Vive separada de `send-to-patient.ts` porque é a regra que mais precisa ser
 * verificável sozinha: errar aqui manda mensagem para quem recusou, e isso não
 * se desfaz. Função pura significa que o teste cobre a matriz inteira sem
 * banco, sem rede e sem mock.
 */

import { isSendablePhone } from '@/lib/core/whatsapp/phone'
import type { ChannelPreference, MessageChannel, SendFailureReason } from './types'

export interface ConsentInput {
  /** Status do cadastro. Só `ativo` recebe. */
  status: string | null
  /** Consentimento de FINALIDADE (acompanhamento). Não herda do lembrete. */
  outreachOptIn: boolean
  /** Consentimento de CANAL WhatsApp. */
  whatsappOptIn: boolean
  phone: string | null
  email: string | null
  preference: ChannelPreference
  /** A clínica tem WhatsApp conectado agora? */
  whatsappConnected: boolean
}

export type ConsentDecision =
  | { ok: true; channel: MessageChannel }
  | { ok: false; reason: SendFailureReason; detail?: string }

/**
 * Ordem das checagens importa, e não é arbitrária: vai do mais determinante ao
 * mais circunstancial. Status do cadastro vence tudo; depois a finalidade;
 * depois o canal. Assim o motivo devolvido é sempre a razão MAIS FUNDAMENTAL
 * pela qual a mensagem não saiu — dizer "canal indisponível" para um paciente
 * arquivado mandaria a clínica consertar o telefone de quem não deveria receber
 * de qualquer forma.
 */
export function decideConsentAndChannel(input: ConsentInput): ConsentDecision {
  if (input.status && input.status !== 'ativo') {
    return { ok: false, reason: 'sem_consentimento', detail: 'paciente-inativo' }
  }

  // Finalidade. `reminders_opt_in` NÃO participa: lembrete de consulta e
  // acompanhamento entre consultas são finalidades distintas em LGPD, e aceite
  // dado para uma não vale para a outra.
  if (!input.outreachOptIn) {
    return { ok: false, reason: 'sem_consentimento', detail: 'finalidade' }
  }

  const telefoneUtil = Boolean(input.phone) && isSendablePhone(input.phone as string)
  const emailUtil = Boolean(input.email)

  if (!telefoneUtil && !emailUtil) {
    return { ok: false, reason: 'sem_contato' }
  }

  const whatsUtil = telefoneUtil && input.whatsappOptIn && input.whatsappConnected

  if (input.preference === 'whatsapp') {
    if (whatsUtil) return { ok: true, channel: 'whatsapp' }
    // Recusa de canal é consentimento, não indisponibilidade técnica. Colapsar
    // as duas esconderia um número desconectado atrás de "o paciente não quis".
    if (telefoneUtil && !input.whatsappOptIn) {
      return { ok: false, reason: 'sem_consentimento', detail: 'canal-whatsapp' }
    }
    return { ok: false, reason: 'canal_indisponivel' }
  }

  if (input.preference === 'email') {
    return emailUtil
      ? { ok: true, channel: 'email' }
      : { ok: false, reason: 'canal_indisponivel' }
  }

  // `preferencial`: WhatsApp quando dá, e-mail como alternativa.
  if (whatsUtil) return { ok: true, channel: 'whatsapp' }
  if (emailUtil) return { ok: true, channel: 'email' }
  return { ok: false, reason: 'canal_indisponivel' }
}
