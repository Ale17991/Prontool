/**
 * Feature 051 — Tipos canônicos da cápsula de WhatsApp.
 *
 * A cápsula é irmã de `core/reminders`, não subordinada: quem quiser mandar
 * WhatsApp para outra coisa (confirmação de agendamento, resultado de exame,
 * motor de notificações) usa daqui sem passar pelo motor de lembretes.
 *
 * Espelham o schema da migration 0185 e o contrato REST documentado em
 * `specs/051-whatsapp-evolution/contracts/whatsapp-service.md`.
 */

/** Estado da conexão de WhatsApp de uma clínica. */
export type WhatsAppConnectionStatus = 'disconnected' | 'connecting' | 'connected'

/**
 * Motivo da queda da conexão (FR-012a).
 *
 * `blocked` é o caso em que o número foi bloqueado pelo WhatsApp — precisa ser
 * distinguível de uma queda comum, porque a ação da clínica é outra (trocar de
 * número, não reconectar). O canal NUNCA é desligado automaticamente por isso.
 */
export type WhatsAppDisconnectReason = 'logged_out' | 'blocked' | 'unknown'

/** Conexão de WhatsApp de uma clínica — projeção segura, sem a credencial. */
export interface WhatsAppConnection {
  tenantId: string
  serviceTenantSlug: string
  instanceName: string | null
  status: WhatsAppConnectionStatus
  /** Preenchido apenas quando `status !== 'connected'`. */
  disconnectReason: WhatsAppDisconnectReason | null
  /** Número vinculado, para exibição. */
  numberConnected: string | null
  connectedAt: string | null
  lastStatusAt: string | null
}

/**
 * Status de entrega de uma mensagem. A ordem importa: a leitura resolve o
 * status corrente pelo MAIOR rank, não pelo evento mais recente — uma
 * confirmação de `delivered` que chega atrasada não rebaixa um `read` (FR-019).
 */
export type WhatsAppDeliveryStatus = 'sent' | 'delivered' | 'read' | 'error'

export const DELIVERY_RANK: Record<WhatsAppDeliveryStatus, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  error: 9,
}

/** Um evento de entrega, como gravado em `whatsapp_delivery_events`. */
export interface WhatsAppDeliveryEvent {
  id: string
  tenantId: string
  reminderId: string
  providerMessageId: string | null
  status: WhatsAppDeliveryStatus
  errorDetail: string | null
  occurredAt: string
  receivedAt: string
}

/**
 * Resultado de um envio pelo serviço.
 *
 * `indefinido` é o desfecho de um envio cuja resposta HTTP não voltou a tempo:
 * a mensagem provavelmente SAIU (a Evolution demora a despachar a primeira de
 * uma instância recém-vinculada), mas não temos o id dela. Não é sucesso nem
 * falha, e tratá-lo como falha foi o defeito que o primeiro envio real expôs —
 * a mensagem chegou no celular e o histórico dizia "falhou". O serviço reata o
 * registro quando a confirmação da Evolution chega (`claimOrphan`), então é a
 * trilha de `whatsapp_delivery_events` que dá a palavra final.
 */
export type WhatsAppSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: true; indefinido: true; providerMessageId: string }
  | { ok: false; kind: WhatsAppSendFailure; detail: string }

/**
 * Classificação da falha de envio. Cada uma leva a um desfecho diferente no
 * motor de lembretes — ver a tabela em `contracts/whatsapp-service.md` §3.
 *
 * - `no_connection`: a clínica não tem número conectado. ABORTA o lote dela
 *   inteiro e vira uma única ocorrência agregada (FR-012), em vez de uma falha
 *   por paciente.
 * - `unauthorized`: a credencial da clínica é inválida — configuração quebrada.
 * - `send_failed` / `timeout`: falha pontual daquela mensagem; o lote continua.
 */
export type WhatsAppSendFailure = 'no_connection' | 'unauthorized' | 'send_failed' | 'timeout'

/** Instância como devolvida pelo serviço na listagem. */
export interface WhatsAppServiceInstance {
  evolutionName: string
  status: string
  numberConnected: string | null
  disconnectReason: WhatsAppDisconnectReason | null
}
