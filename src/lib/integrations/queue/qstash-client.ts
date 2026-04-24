import { Client } from '@upstash/qstash'
import { logger } from '@/lib/observability/logger'

let qstashSingleton: Client | null = null

export function isQstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN) && Boolean(process.env.NEXT_PUBLIC_APP_URL)
}

function getQstash(token: string): Client {
  if (qstashSingleton) return qstashSingleton
  qstashSingleton = new Client({ token })
  return qstashSingleton
}

/**
 * Enqueues a raw webhook event for semantic processing. QStash retries
 * with exponential backoff on 5xx from the callback; after the configured
 * retry budget the message lands in QStash's DLQ and ours.
 *
 * When QStash is not configured (missing QSTASH_TOKEN or NEXT_PUBLIC_APP_URL),
 * returns `{ messageId: null }` and logs a warning. Callers that need
 * guaranteed delivery should gate on `isQstashConfigured()` and 503 upfront;
 * best-effort callers can ignore the null result.
 */
export async function enqueueGhlEvent(args: {
  rawEventId: string
  tenantId: string
  traceId: string
}): Promise<{ messageId: string | null }> {
  const token = process.env.QSTASH_TOKEN
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!token || !appUrl) {
    logger.warn(
      { ...args, has_token: Boolean(token), has_app_url: Boolean(appUrl) },
      'qstash-not-configured-skipping-enqueue',
    )
    return { messageId: null }
  }

  const callback = new URL('/api/workers/process-ghl-event', appUrl).toString()

  try {
    const res = await getQstash(token).publishJSON({
      url: callback,
      body: { rawEventId: args.rawEventId, tenantId: args.tenantId },
      retries: 5,
      headers: { 'X-Trace-Id': args.traceId },
    })
    return { messageId: res.messageId }
  } catch (err) {
    logger.error({ err, ...args }, 'qstash-publish-failed')
    throw err
  }
}
