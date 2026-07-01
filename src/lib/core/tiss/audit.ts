import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { maskTissForLog } from './mask'

/**
 * Registra um evento TISS em `audit_log` (Princípio II). O `detail` passa por
 * `maskTissForLog` antes de serializar — segredos (certificado/senha) e PII
 * (carteira/nome) nunca chegam ao audit em texto claro.
 */
export interface TissAuditInput {
  tenantId: string
  actorUserId: string | null
  actorLabel: string | null
  entity: string
  entityId: string
  /** ex.: `tiss.operator.configure`, `tiss.certificate.upload`, `tiss.lote.export`. */
  field: string
  detail?: Record<string, unknown>
  reason: string
  ip?: string | null
  userAgent?: string | null
  result?: 'success' | 'denied' | 'conflict'
}

export async function recordTissAudit(
  supabase: SupabaseClient<Database>,
  input: TissAuditInput,
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: input.actorLabel,
    entity: input.entity,
    entity_id: input.entityId,
    field: input.field,
    old_value: null,
    new_value: input.detail ? JSON.stringify(maskTissForLog(input.detail)) : null,
    reason: input.reason,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    result: input.result ?? 'success',
  })
  if (error) throw new Error(`recordTissAudit insert failed: ${error.message}`)
}
