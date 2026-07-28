/**
 * Feature 051 — Cápsula de WhatsApp.
 *
 * Irmã de `core/reminders`, não subordinada: o motor de lembretes é o primeiro
 * consumidor, mas qualquer outra coisa (confirmação de agendamento, resultado
 * de exame, o futuro motor de notificações) manda WhatsApp daqui sem passar
 * por ele.
 */

export type {
  WhatsAppConnection,
  WhatsAppConnectionStatus,
  WhatsAppDisconnectReason,
  WhatsAppDeliveryEvent,
  WhatsAppDeliveryStatus,
  WhatsAppSendFailure,
  WhatsAppSendResult,
  WhatsAppServiceInstance,
} from './types'
export { DELIVERY_RANK } from './types'

export { getOnlyNumbers, normalizePhone, isSendablePhone, toWhatsAppJid } from './phone'

export {
  getWhatsAppConnection,
  isWhatsAppConnected,
  saveWhatsAppCredentials,
  getDecryptedApiKey,
  updateConnectionState,
  deleteWhatsAppConnection,
} from './config'

export {
  isWhatsAppServiceConfigured,
  provisionTenant,
  createInstance,
  connectInstance,
  listInstances,
  deleteInstance,
  sendText,
} from './service-client'
