import { logger } from '@/lib/observability/logger'
import type { GhlProxyCredentials } from './create-contact'

export interface CreateNoteInput {
  contactId: string
  body: string
}

/**
 * Post a note to a GHL contact via the Homio Operations proxy
 * (/functions/v1/create-contact-note). Structured symmetrically to
 * createContactInGhl: requires operationsUrl/Key/locationId either
 * from creds override or env vars.
 */
export async function createNoteInGhl(
  input: CreateNoteInput,
  creds: GhlProxyCredentials = {},
): Promise<void> {
  const url = creds.operationsUrl ?? process.env.SUPABASE_OPERATIONS_URL
  const key = creds.operationsKey ?? process.env.SUPABASE_OPERATIONS_ANON_KEY
  const locationId = creds.locationId ?? process.env.GHL_LOCATION_ID
  if (!url || !key || !locationId) {
    throw new Error('createNoteInGhl: missing proxy credentials (url/key/locationId)')
  }

  const endpoint = `${url.replace(/\/+$/, '')}/functions/v1/create-contact-note`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      locationId,
      contactId: input.contactId,
      body: input.body,
    }),
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logger.warn(
      { status: res.status, endpoint, responseBody: text.slice(0, 200) },
      'ghl-create-note-failed',
    )
    throw new Error(`GHL proxy returned ${res.status} on create-note`)
  }
}
