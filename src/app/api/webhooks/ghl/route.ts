import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { verifyGhlSignature } from '@/lib/integrations/ghl/verify-signature'
import { ingestRawEvent } from '@/lib/core/webhooks/ingest-raw-event'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import { enqueueGhlEvent } from '@/lib/integrations/queue/qstash-client'
import { InvalidSignatureError } from '@/lib/observability/errors'
import { mintTraceId } from '@/lib/observability/trace'
import { logger } from '@/lib/observability/logger'
import type { Json } from '@/lib/db/types'

/**
 * T084 — GHL webhook ingestion.
 *
 * Flow (hard-capped at <1 s p95 by keeping the durable write to a single
 * upsert and punting semantic work to QStash):
 *   1. Mint a trace id so subsequent worker logs correlate with this request.
 *   2. Parse the body and pull `event_id` — 400 if absent or unparseable.
 *   3. Look up every tenant's decrypted webhook_secret and try the HMAC
 *      against each. First match wins. No match → 401 + signature_failure
 *      alerts on each configured tenant (dispatcher dedup absorbs noise).
 *   4. Persist the raw payload idempotently via T078.
 *   5. Fire-and-forget enqueue to QStash for the worker (skipped in tests).
 *   6. 200 with `{ received, duplicate, raw_event_id }`.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const payloadShape = z.object({ event_id: z.string().min(1) }).passthrough()

export async function POST(req: Request): Promise<Response> {
  const traceId = mintTraceId()
  const signature = req.headers.get('x-ghl-signature')
  const timestamp = req.headers.get('x-ghl-timestamp')

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Body is not readable' } },
      { status: 400 },
    )
  }

  const parsed = tryParse(rawBody)
  if (!parsed) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Body is not valid JSON' } },
      { status: 400 },
    )
  }
  const shape = payloadShape.safeParse(parsed)
  if (!shape.success) {
    return NextResponse.json(
      {
        error: {
          code: 'MISSING_EVENT_ID',
          message: 'event_id is required',
          issues: shape.error.issues,
        },
      },
      { status: 400 },
    )
  }
  const ghlEventId = shape.data.event_id

  const supabase = createSupabaseServiceClient()
  const tenantId = await identifyTenantBySignature(supabase, {
    signature,
    timestamp,
    rawBody,
  })

  if (!tenantId) {
    await notifySignatureFailure(supabase, { ghlEventId, traceId })
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } },
      { status: 401 },
    )
  }

  const headersObj: Record<string, string> = {}
  req.headers.forEach((v, k) => {
    // Drop the signature headers from the persisted log — they are secrets.
    if (k === 'x-ghl-signature' || k === 'x-ghl-timestamp' || k === 'authorization') return
    headersObj[k] = v
  })

  const { rawEventId, duplicate } = await ingestRawEvent(supabase, {
    tenantId,
    ghlEventId,
    payload: parsed as Json,
    headers: headersObj as Json,
  })

  if (!duplicate) {
    enqueueBestEffort({ rawEventId, tenantId, traceId })
  }

  logger.info(
    { trace_id: traceId, tenant_id: tenantId, raw_event_id: rawEventId, duplicate },
    'ghl-webhook-received',
  )

  return NextResponse.json(
    { received: true, duplicate, raw_event_id: rawEventId },
    { status: 200, headers: { 'x-trace-id': traceId } },
  )
}

function tryParse(body: string): unknown | null {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

async function identifyTenantBySignature(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  args: { signature: string | null; timestamp: string | null; rawBody: string },
): Promise<string | null> {
  if (!args.signature || !args.timestamp) return null

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY missing')

  const { data: configs, error } = await supabase
    .from('tenant_ghl_config')
    .select('tenant_id, webhook_secret_enc')
  if (error) throw new Error(`tenant_ghl_config scan failed: ${error.message}`)
  if (!configs || configs.length === 0) return null

  for (const cfg of configs) {
    const { data: decrypted, error: decErr } = await supabase.rpc('dec_text_with_key', {
      cipher: cfg.webhook_secret_enc as unknown as string,
      key,
    })
    if (decErr || typeof decrypted !== 'string') continue
    try {
      verifyGhlSignature({
        signature: args.signature,
        timestamp: args.timestamp,
        rawBody: args.rawBody,
        secret: decrypted,
      })
      return cfg.tenant_id
    } catch (err) {
      if (err instanceof InvalidSignatureError) continue
      throw err
    }
  }
  return null
}

async function notifySignatureFailure(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  ctx: { ghlEventId: string; traceId: string },
): Promise<void> {
  // We don't know which tenant the payload was intended for, so alert every
  // configured tenant. Dispatcher dedup (1h window on subject_ref) absorbs
  // retries from the same caller.
  const { data: tenants, error } = await supabase.from('tenant_ghl_config').select('tenant_id')
  if (error || !tenants) return
  for (const { tenant_id: tenantId } of tenants) {
    try {
      await dispatchAlert({
        tenantId,
        type: 'signature_failure',
        subjectRef: { ghl_event_id: ctx.ghlEventId },
        detail: { ghl_event_id: ctx.ghlEventId, trace_id: ctx.traceId },
      })
    } catch (err) {
      logger.error({ err, tenant_id: tenantId }, 'signature-failure-alert-dispatch-failed')
    }
  }
}

function enqueueBestEffort(args: { rawEventId: string; tenantId: string; traceId: string }): void {
  // In test mode we skip real QStash — tests drive the worker directly.
  if (process.env.NODE_ENV === 'test' || !process.env.QSTASH_TOKEN) return
  enqueueGhlEvent(args).catch((err: unknown) => {
    logger.error({ err, ...args }, 'qstash-enqueue-failed-after-durable-write')
  })
}
