export type { Database, Json } from './generated/types'

export type TenantRole = 'admin' | 'financeiro' | 'recepcionista' | 'profissional_saude'

export type WebhookProcessingStatus = 'pending' | 'processing' | 'done' | 'dlq' | 'reprocessed'

export type AppointmentEffectiveStatus = 'ativo' | 'estornado'

export type AlertType =
  | 'dlq_event'
  | 'webhook_rejected'
  | 'tuss_deprecated'
  | 'signature_failure'
  | 'rbac_denied'
  | 'integration_sync_failed'

export type AuditResult = 'success' | 'denied' | 'conflict'
