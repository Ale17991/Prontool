import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { recordSyncSuccess, recordSyncFailure } from '@/lib/core/integrations/ghl/sync-log'
import { updateGhlConfig } from '@/lib/core/integrations/ghl/config-update'
import {
  GHL_API_BASE,
  GHL_API_VERSION,
  GHL_WEBHOOK_EVENTS,
  type GhlConfigV2,
  type GhlWebhookEvent,
} from './types'

/**
 * Feature 008 — Setup pós-conexão de Webhooks na sub-account.
 *
 * Para cada um de `ContactCreate`, `ContactUpdate`, `OpportunityStatusUpdate`:
 * faz `GET /hooks/?locationId=...`, decide reuse-by-(event, targetUrl) ou
 * cria via `POST /hooks/`. Persiste mapa `webhook_ids` em config.
 */

const REQUEST_TIMEOUT_MS = 5_000

interface RemoteHook {
  id: string
  event?: string
  targetUrl?: string
}

export interface WebhooksSetupResult {
  ids: GhlConfigV2['webhook_ids']
  warnings: string[]
}

export async function webhooksSetup(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  accessToken: string,
  locationId: string,
  prontoolBaseUrl: string,
): Promise<WebhooksSetupResult> {
  const targetUrl = `${prontoolBaseUrl.replace(/\/$/, '')}/api/webhooks/ghl`
  const warnings: string[] = []
  const result: GhlConfigV2['webhook_ids'] = {}

  let existing: RemoteHook[]
  try {
    existing = await listHooks(accessToken, locationId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn({ tenant_id: tenantId, err: message }, 'ghl-webhooks-list-failed')
    await recordSyncFailure(supabase, tenantId, {
      kind: 'webhook_setup',
      errorCode: 'LIST_FAILED',
      errorMessage: message,
    })
    return { ids: {}, warnings: ['webhooks:list_failed'] }
  }

  for (const event of GHL_WEBHOOK_EVENTS) {
    try {
      const reuse = existing.find(
        (h) => h.event === event && h.targetUrl === targetUrl,
      )
      let id: string
      if (reuse) {
        id = reuse.id
      } else {
        id = await createHook(accessToken, locationId, { event, targetUrl })
      }
      result[event] = id
      await recordSyncSuccess(supabase, tenantId, {
        kind: 'webhook_setup',
        detail: { event, action: reuse ? 'reuse' : 'create' },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(
        { tenant_id: tenantId, event, err: message },
        'ghl-webhook-setup-failed',
      )
      await recordSyncFailure(supabase, tenantId, {
        kind: 'webhook_setup',
        errorCode: 'SETUP_FAILED',
        errorMessage: message,
        detail: { event },
      })
      warnings.push(`webhook_${event.toLowerCase()}:setup_failed`)
    }
  }

  if (Object.keys(result).length > 0) {
    await updateGhlConfig(supabase, tenantId, { webhook_ids: result })
  }
  return { ids: result, warnings }
}

async function listHooks(accessToken: string, locationId: string): Promise<RemoteHook[]> {
  const res = await fetch(
    `${GHL_API_BASE}/hooks/?locationId=${encodeURIComponent(locationId)}`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GHL list hooks ${res.status}: ${text.slice(0, 200)}`)
  }
  const body = (await res.json().catch(() => null)) as
    | { hooks?: RemoteHook[] }
    | RemoteHook[]
    | null
  if (!body) return []
  if (Array.isArray(body)) return body
  return body.hooks ?? []
}

async function createHook(
  accessToken: string,
  locationId: string,
  hook: { event: GhlWebhookEvent; targetUrl: string },
): Promise<string> {
  const res = await fetch(`${GHL_API_BASE}/hooks/`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      locationId,
      event: hook.event,
      targetUrl: hook.targetUrl,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GHL create hook ${res.status}: ${text.slice(0, 200)}`)
  }
  const body = (await res.json().catch(() => null)) as
    | { id?: string; hook?: { id?: string } }
    | null
  const id = body?.id ?? body?.hook?.id
  if (!id) throw new Error('GHL create hook returned no id')
  return id
}
