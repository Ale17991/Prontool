import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  verifyQstashSignature,
  isQstashSigningConfigured,
} from '@/lib/integrations/queue/verify-qstash-signature'
import { processWebhookEvent } from '@/lib/core/webhooks/process-event'
import { InvalidSignatureError } from '@/lib/observability/errors'
import { traceIdFromHeaders } from '@/lib/observability/trace'
import { logger } from '@/lib/observability/logger'

/**
 * T085 — QStash callback that drives a raw webhook event through semantic
 * processing. Terminal outcomes (appointment created / DLQ routed) respond
 * 200 so QStash stops retrying. Transient errors become 5xx so QStash
 * backs off and retries within its configured budget; after the budget
 * the event sits in `raw_webhook_events` with status='processing' and
 * operators can inspect `webhook_event_transitions` to see why.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodyShape = z.object({ rawEventId: z.string().uuid() }).passthrough()

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const traceId = traceIdFromHeaders(req.headers)

  // QStash verification is skipped in test mode — tests drive the worker
  // directly with a synthetic body.
  if (process.env.NODE_ENV !== 'test') {
    if (!isQstashSigningConfigured()) {
      logger.warn({ trace_id: traceId }, 'qstash-signing-not-configured')
      return NextResponse.json(
        { error: { code: 'QSTASH_NOT_CONFIGURED', message: 'Worker disabled' } },
        { status: 503 },
      )
    }
    try {
      await verifyQstashSignature({
        signature: req.headers.get('upstash-signature'),
        body: rawBody,
        url: req.url,
      })
    } catch (err) {
      if (err instanceof InvalidSignatureError) {
        return NextResponse.json(
          { error: { code: 'INVALID_SIGNATURE', message: 'QStash signature invalid' } },
          { status: 401 },
        )
      }
      throw err
    }
  }

  const parsed = tryParse(rawBody)
  const shape = bodyShape.safeParse(parsed)
  if (!shape.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'rawEventId is required' } },
      { status: 400 },
    )
  }

  const supabase = createSupabaseServiceClient()
  try {
    const result = await processWebhookEvent(supabase, {
      rawEventId: shape.data.rawEventId,
      traceId,
    })
    return NextResponse.json(result, { status: 200, headers: { 'x-trace-id': traceId } })
  } catch (err) {
    // Transient — surface as 5xx so QStash retries. Domain errors never
    // reach this block; they're handled inside processWebhookEvent.
    logger.error(
      { err, trace_id: traceId, raw_event_id: shape.data.rawEventId },
      'worker-transient-failure',
    )
    return NextResponse.json(
      { error: { code: 'TRANSIENT_ERROR', message: 'Retry later' } },
      { status: 503 },
    )
  }
}

function tryParse(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}
