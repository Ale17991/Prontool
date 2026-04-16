import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { AuditResult } from '@/lib/db/types'

export interface DenyAuditInput {
  tenantId: string
  actorId?: string | null
  actorLabel?: string | null
  entity: string
  entityId?: string
  field?: string
  reason: string
  ip?: string
  userAgent?: string
  result: Extract<AuditResult, 'denied' | 'conflict'>
}

/**
 * Inserts an audit_log row for a deny / conflict event. Not routed through
 * the AFTER-INSERT triggers because those fire on successful domain writes;
 * denies/conflicts never produce such a write.
 *
 * Uses the service-role client (bypasses RLS) because the acting user is
 * often unauthorized to write to audit_log by their own role policy.
 */
export async function denyAudit(input: DenyAuditInput): Promise<void> {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorId ?? null,
    actor_label: input.actorLabel ?? null,
    entity: input.entity,
    entity_id: input.entityId ?? null,
    field: input.field ?? null,
    old_value: null,
    new_value: null,
    reason: input.reason,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    result: input.result,
  })
  if (error) throw new Error(`denyAudit insert failed: ${error.message}`)
}
