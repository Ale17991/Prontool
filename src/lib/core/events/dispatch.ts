import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type {
  AdapterContext,
  DispatchResult,
  DomainEvent,
  IntegrationAdapter,
} from '@/lib/integrations/types'
import { getEnabledIntegrations, type TenantIntegrationRow } from '@/lib/core/integrations/config'
import { decryptCredentials } from '@/lib/core/integrations/credentials'
import { getAdapter } from '@/lib/integrations/registry'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import { logger } from '@/lib/observability/logger'

const PER_ADAPTER_TIMEOUT_MS = 5_000

/**
 * Fan-out a DomainEvent to every enabled adapter for the tenant.
 *
 * - Standalone tenant (zero enabled integrations) → returns `[]` without any
 *   side effect (no HTTP, no alerts, no logs about integrations).
 * - For each enabled integration: decrypt credentials, parse config, build
 *   AdapterContext, invoke `adapter.handleDomainEvent` with a 5 s timeout.
 * - Failures are captured per-adapter via `Promise.allSettled`; a failure in
 *   one adapter does not block the others. Each failure dispatches an
 *   `integration_sync_failed` alert (best-effort — a failure to create the
 *   alert is logged but not re-raised).
 */
export async function dispatchDomainEvent(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  event: DomainEvent,
): Promise<DispatchResult[]> {
  const enabled = await getEnabledIntegrations(supabase, tenantId)
  if (enabled.length === 0) return []

  const tasks = enabled.map((row) => runAdapter(supabase, tenantId, row, event))
  const settled = await Promise.allSettled(tasks)

  const results: DispatchResult[] = settled.map((s, idx) => {
    if (s.status === 'fulfilled') {
      return s.value
    }
    // Should not happen — runAdapter catches internally — but belt-and-suspenders.
    const row = enabled[idx]!
    const reason = s.reason instanceof Error ? s.reason.message : String(s.reason)
    return { provider: row.provider, ok: false, detail: reason.slice(0, 160) }
  })

  // Fire alerts for failures outside the Promise.allSettled loop so slow alert
  // dispatch doesn't extend the fan-out latency.
  for (const r of results) {
    if (r.ok) continue
    try {
      await dispatchAlert({
        tenantId,
        type: 'integration_sync_failed',
        subjectRef: subjectRefFor(event),
        detail: {
          provider: r.provider,
          route: 'dispatchDomainEvent',
          action: actionFor(event),
          failure_reason: r.detail,
        },
      })
    } catch (alertErr) {
      logger.error(
        { tenantId, provider: r.provider, err: (alertErr as Error).message },
        'integration-sync-alert-dispatch-threw',
      )
    }
  }

  return results
}

async function runAdapter(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  row: TenantIntegrationRow,
  event: DomainEvent,
): Promise<DispatchResult> {
  const adapter = getAdapter(row.provider)
  if (!adapter) {
    return { provider: row.provider, ok: false, detail: 'adapter_not_registered' }
  }

  let credentials: unknown
  try {
    credentials = await decryptCredentials(supabase, row, adapter.credentialsSchema)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { provider: row.provider, ok: false, detail: `decrypt_failed: ${msg.slice(0, 100)}` }
  }

  const configParsed = adapter.configSchema.safeParse(row.config)
  if (!configParsed.success) {
    return {
      provider: row.provider,
      ok: false,
      detail: `config_invalid: ${configParsed.error.issues[0]?.message ?? 'unknown'}`,
    }
  }

  const ctx: AdapterContext = {
    tenantId,
    provider: adapter.provider,
    config: configParsed.data,
    credentials,
    supabase,
    logger: logger.child({ tenant_id: tenantId, provider: adapter.provider }),
    now: () => new Date(),
  }

  try {
    await withTimeout(
      (adapter as IntegrationAdapter).handleDomainEvent(ctx, event),
      PER_ADAPTER_TIMEOUT_MS,
      `${adapter.provider}_timeout`,
    )
    return {
      provider: adapter.provider,
      ok: true,
      detail: detailForOk(event, adapter.provider),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { provider: adapter.provider, ok: false, detail: msg.slice(0, 160) }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let handle: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(label)), ms)
  })
  return Promise.race([p, timeout]).finally(() => {
    if (handle) clearTimeout(handle)
  }) as Promise<T>
}

function subjectRefFor(event: DomainEvent): Record<string, unknown> {
  switch (event.type) {
    case 'patient.created':
      return { patient_id: event.patient.id }
    case 'appointment.created':
      return { appointment_id: event.appointment.id }
    case 'appointment.reversed':
      return { appointment_id: event.original.id }
  }
}

function actionFor(event: DomainEvent): string {
  switch (event.type) {
    case 'patient.created':
      return 'create_contact'
    case 'appointment.created':
      return 'create_note'
    case 'appointment.reversed':
      return 'reverse_note'
  }
}

function detailForOk(event: DomainEvent, provider: string): string {
  switch (event.type) {
    case 'patient.created':
      return provider === 'ghl' ? 'contact_created' : 'patient_dispatched'
    case 'appointment.created':
      return provider === 'ghl' ? 'note_created' : 'appointment_dispatched'
    case 'appointment.reversed':
      return 'reversal_dispatched'
  }
}
