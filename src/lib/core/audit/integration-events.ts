import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { ProviderId, IntegrationAdapter } from '@/lib/integrations/types'

export type IntegrationEventType =
  | 'integration.connect'
  | 'integration.reconfigure'
  | 'integration.disconnect'

export interface RecordIntegrationEventInput {
  type: IntegrationEventType
  tenantId: string
  provider: ProviderId
  actorUserId: string
  actorLabel?: string | null
  /** Adapter used to redact credentials. */
  adapter: IntegrationAdapter<any, any>
  /** Previous state, already object form. Credentials will be redacted. */
  before: { config: unknown; credentials: unknown | null } | null
  after: { config: unknown; credentials: unknown | null } | null
  reason: string
  ip?: string | null
  userAgent?: string | null
}

/**
 * Record an integration lifecycle event in audit_log. Constitution §II:
 * reason, actor, timestamp, ip, ua are all persisted.
 *
 * Credentials are ALWAYS redacted via the adapter before write. The
 * encrypted blob never reaches audit_log — only the masked shape.
 */
export async function recordIntegrationEvent(
  supabase: SupabaseClient<Database>,
  input: RecordIntegrationEventInput,
): Promise<void> {
  const before = input.before
    ? {
        config: input.before.config,
        credentials:
          input.before.credentials === null
            ? null
            : input.adapter.redactCredentials(input.before.credentials),
      }
    : null
  const after = input.after
    ? {
        config: input.after.config,
        credentials:
          input.after.credentials === null
            ? null
            : input.adapter.redactCredentials(input.after.credentials),
      }
    : null

  const { error } = await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: input.actorLabel ?? null,
    entity: 'tenant_integrations',
    entity_id: input.tenantId,
    field: `${input.type}:${input.provider}`,
    old_value: before ? JSON.stringify(before) : null,
    new_value: after ? JSON.stringify(after) : null,
    reason: input.reason,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    result: 'success',
  })
  if (error) {
    throw new Error(`recordIntegrationEvent insert failed: ${error.message}`)
  }
}
