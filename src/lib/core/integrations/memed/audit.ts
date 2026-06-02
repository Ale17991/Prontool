import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { redactMemedDetail } from './mask-pii'

/**
 * Registra um evento Memed em `audit_log` (Princípio II). O `detail` passa
 * por `redactMemedDetail` antes de serializar — segredos e PII nunca chegam
 * ao audit em texto claro.
 */
export interface MemedAuditInput {
  tenantId: string
  actorUserId: string | null
  actorLabel: string | null
  entity: string
  entityId: string
  /** ex.: `memed.connect`, `memed.prescriber.enable`, `prescription.issued`. */
  field: string
  detail?: Record<string, unknown>
  reason: string
  ip?: string | null
  userAgent?: string | null
  result?: 'success' | 'denied' | 'conflict'
}

export async function recordMemedAudit(
  supabase: SupabaseClient<Database>,
  input: MemedAuditInput,
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: input.actorLabel,
    entity: input.entity,
    entity_id: input.entityId,
    field: input.field,
    old_value: null,
    new_value: input.detail ? JSON.stringify(redactMemedDetail(input.detail)) : null,
    reason: input.reason,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    result: input.result ?? 'success',
  })
  if (error) throw new Error(`recordMemedAudit insert failed: ${error.message}`)
}
