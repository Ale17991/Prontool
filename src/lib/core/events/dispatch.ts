import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { DomainEvent, DispatchResult } from '@/lib/integrations/types'
import { getEnabledIntegrations } from '@/lib/core/integrations/config'
import { getAdapter } from '@/lib/integrations/registry'

/**
 * Fan-out a DomainEvent to every enabled adapter for the tenant.
 *
 * US1 (standalone) ships with this function returning [] for tenants that
 * have zero enabled integrations — no side effects, no alerts, no logs.
 *
 * US3 extends this function to (a) decrypt credentials, (b) build
 * AdapterContext for each adapter, (c) call handleDomainEvent inside a
 * Promise.allSettled with 5s per-adapter timeout, and (d) dispatch
 * `integration_sync_failed` alerts on rejection.
 *
 * For now (US1 foundational), the stub path: load enabled integrations,
 * skip any provider without a registered adapter, and return a noop result
 * per provider so the contract shape is stable.
 */
export async function dispatchDomainEvent(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  _event: DomainEvent,
): Promise<DispatchResult[]> {
  const enabled = await getEnabledIntegrations(supabase, tenantId)
  if (enabled.length === 0) return []

  // US3 replaces this block with full fan-out. For now: iterate and return
  // a deterministic "not dispatched yet" result so tests can distinguish
  // "tenant standalone" (empty array) from "tenant connected, fan-out WIP"
  // (non-empty with ok:false + detail:'not_implemented').
  const results: DispatchResult[] = []
  for (const row of enabled) {
    const adapter = getAdapter(row.provider)
    if (!adapter) {
      results.push({ provider: row.provider, ok: false, detail: 'adapter_not_registered' })
      continue
    }
    results.push({ provider: row.provider, ok: false, detail: 'dispatch_not_implemented' })
  }
  return results
}
