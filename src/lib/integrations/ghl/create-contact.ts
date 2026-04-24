import { logger } from '@/lib/observability/logger'

/**
 * Outbound GHL contact creation. Follows the proxy pattern used by the
 * Homio real-estate admin: Next.js does NOT hit services.leadconnectorhq.com
 * directly — it forwards to a Supabase Edge Function hosted in the Homio
 * Operations project, which holds the GHL OAuth/PIT credentials. Keeps
 * GHL auth concerns off this app entirely.
 *
 * Env vars required:
 *   - SUPABASE_OPERATIONS_URL         base URL of the operations project
 *   - SUPABASE_OPERATIONS_ANON_KEY    bearer token for the proxy
 *   - GHL_LOCATION_ID                 the GHL location where contacts land
 *
 * If any are missing the function returns `{ configured: false }` — the
 * caller treats that as "GHL sync not configured in this environment",
 * saves the patient locally, and does not raise an alert (unlike an
 * actual sync failure).
 */

export interface CreateContactInput {
  fullName: string
  phone?: string | undefined
  email?: string | undefined
  /** Free-text source tag — e.g., "homio-faturamento:manual" */
  source?: string | undefined
}

export type CreateContactResult =
  | { configured: false }
  | { configured: true; ghlContactId: string }

export interface GhlProxyCredentials {
  /** Base URL of the Homio Operations Supabase project. Env var when omitted (shared infra). */
  operationsUrl?: string
  /** Bearer key for the proxy. Env var when omitted (shared infra). */
  operationsKey?: string
  /** GHL location id — MUST be provided by the adapter from tenant config. */
  locationId: string
}

/**
 * Outbound GHL contact creation. Called by the GHL adapter with locationId
 * sourced from tenant_integrations.config. `operationsUrl` and `operationsKey`
 * fall back to env vars (the proxy is shared infra across tenants); if neither
 * is configured, returns {configured:false} and the caller treats that as a
 * skip, not a failure.
 */
export async function createContactInGhl(
  input: CreateContactInput,
  creds: GhlProxyCredentials,
): Promise<CreateContactResult> {
  const url = creds.operationsUrl ?? process.env.SUPABASE_OPERATIONS_URL
  const key = creds.operationsKey ?? process.env.SUPABASE_OPERATIONS_ANON_KEY
  const locationId = creds.locationId
  if (!url || !key || !locationId) return { configured: false }

  const endpoint = `${url.replace(/\/+$/, '')}/functions/v1/create-contact`
  const body = {
    locationId,
    contact: {
      name: input.fullName,
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.source ? { source: input.source } : {}),
    },
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    // The proxy is co-located with Supabase so a tight timeout is fine;
    // AbortSignal.timeout keeps a stuck call from blocking the request path.
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logger.warn(
      { status: res.status, endpoint, responseBody: text.slice(0, 200) },
      'ghl-create-contact-failed',
    )
    throw new Error(`GHL proxy returned ${res.status}`)
  }

  const payload = (await res.json().catch(() => null)) as
    | { id?: string; contact?: { id?: string } }
    | null
  const ghlContactId = payload?.id ?? payload?.contact?.id
  if (!ghlContactId) {
    throw new Error('GHL proxy response missing contact id')
  }
  return { configured: true, ghlContactId }
}
