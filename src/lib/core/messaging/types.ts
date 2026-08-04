/**
 * Feature 053 — "enviar mensagem a um paciente", sem consulta no caminho.
 *
 * Esta cápsula nasce SEPARADA de `signals/` de propósito: ela não sabe o que é
 * regra, nem o que é sinal. Resolve contato, consentimento, canal e registro —
 * e nada mais. É a peça que faltava no repo: hoje esses quatro passos estão
 * duplicados literalmente entre `reminders/send-one.ts` e
 * `reminders/send-one-whatsapp.ts`, ambos amarrados a `appointment_id`.
 *
 * Manter a separação é o que permite os lembretes migrarem para cá depois sem
 * arrastar o motor de sinais junto.
 */

export type MessageChannel = 'whatsapp' | 'email'

/** Preferência declarada pela regra. `preferencial` resolve em tempo de envio. */
export type ChannelPreference = MessageChannel | 'preferencial'

/**
 * A finalidade em LGPD. Não é rótulo decorativo: é o que determina QUAL
 * consentimento vale. `acompanhamento` exige `patients.outreach_opt_in`, que é
 * distinto do aceite de lembrete de consulta — quem aceitou ser lembrado da
 * consulta não aceitou por consequência ser acompanhado entre elas.
 */
export type MessagePurpose = 'acompanhamento'

/**
 * Por que uma mensagem não saiu. Recusa e falha são coisas DIFERENTES e a
 * distinção importa: tratá-las como a mesma esconde problema técnico atrás de
 * "o paciente não quis", e inventa problema de consentimento onde havia queda
 * de rede.
 */
export type SendFailureReason =
  | 'sem_consentimento'
  | 'sem_contato'
  | 'canal_indisponivel'
  | 'falha_envio'

export type SendToPatientResult =
  | { ok: true; messageId: string; channel: MessageChannel }
  | { ok: false; reason: SendFailureReason; detail?: string }

export interface SendToPatientInput {
  tenantId: string
  patientId: string
  purpose: MessagePurpose
  /** Texto JÁ renderizado. A cápsula não conhece placeholders. */
  body: string
  preference: ChannelPreference
  /** Assunto do e-mail. Ignorado no WhatsApp. */
  subject?: string
}
