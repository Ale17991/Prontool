import { Client } from '@upstash/qstash'
import { logger } from '@/lib/observability/logger'

let qstashSingleton: Client | null = null

function getQstash(): Client {
  if (qstashSingleton) return qstashSingleton
  const token = process.env.QSTASH_TOKEN
  if (!token) throw new Error('QSTASH_TOKEN missing')
  qstashSingleton = new Client({ token })
  return qstashSingleton
}

/**
 * Enqueues a raw webhook event for semantic processing. QStash retries
 * with exponential backoff on 5xx from the callback; after the configured
 * retry budget the message lands in QStash's DLQ and ours.
 */
export async function enqueueGhlEvent(args: {
  rawEventId: string
  tenantId: string
  traceId: string
}): Promise<{ messageId: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL missing')

  const callback = new URL('/api/workers/process-ghl-event', appUrl).toString()

  try {
    const res = await getQstash().publishJSON({
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
