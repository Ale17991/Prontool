import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/db/types'

/**
 * T078 — durable ingest of a GHL webhook delivery.
 *
 * Persists the raw payload+headers under `(tenant_id, ghl_event_id)`
 * uniqueness so retries from GHL are idempotent. On first insert also
 * records the initial `pending` transition.
 *
 * Returns `{ rawEventId, duplicate }` so the Route Handler can respond 200
 * quickly and QStash enqueue can be skipped on duplicates.
 */
export interface IngestRawEventInput {
  tenantId: string
  ghlEventId: string
  payload: Json
  headers: Json
}

export interface IngestRawEventResult {
  rawEventId: string
  duplicate: boolean
}

export async function ingestRawEvent(
  supabase: SupabaseClient<Database>,
  input: IngestRawEventInput,
): Promise<IngestRawEventResult> {
  // Try to write the new row; ignore duplicates via the (tenant_id, ghl_event_id)
  // unique index. When a duplicate is hit supabase-js returns an empty array.
  const inserted = await supabase
    .from('raw_webhook_events')
    .upsert(
      {
        tenant_id: input.tenantId,
        ghl_event_id: input.ghlEventId,
        payload: input.payload,
        headers: input.headers,
        processing_status: 'pending',
      },
      { onConflict: 'tenant_id,ghl_event_id', ignoreDuplicates: true },
    )
    .select('id')

  if (inserted.error) {
    throw new Error(`ingestRawEvent insert failed: ${inserted.error.message}`)
  }

  if (inserted.data && inserted.data.length > 0) {
    const rawEventId = inserted.data[0]!.id
    const transition = await supabase.from('webhook_event_transitions').insert({
      tenant_id: input.tenantId,
      raw_event_id: rawEventId,
      from_status: null,
      to_status: 'pending',
      reason: 'ingested',
      actor: 'webhook',
    })
    if (transition.error) {
      throw new Error(`ingestRawEvent transition insert failed: ${transition.error.message}`)
    }
    return { rawEventId, duplicate: false }
  }

  // Duplicate — look up the original id so the caller can reply with it.
  const existing = await supabase
    .from('raw_webhook_events')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('ghl_event_id', input.ghlEventId)
    .single()
  if (existing.error || !existing.data) {
    throw new Error(
      `ingestRawEvent duplicate lookup failed: ${existing.error?.message ?? 'not found'}`,
    )
  }
  return { rawEventId: existing.data.id, duplicate: true }
}
