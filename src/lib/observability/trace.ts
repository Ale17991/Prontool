import { randomUUID } from 'node:crypto'
import { logger as baseLogger, requestLogger } from './logger'
import type { Logger } from 'pino'

export function mintTraceId(): string {
  return randomUUID()
}

/**
 * Picks up an incoming trace id from request headers (X-Trace-Id or
 * QStash-Message-Id) or generates a new one.
 */
export function traceIdFromHeaders(headers: Headers | Record<string, string | undefined>): string {
  const get = (k: string) =>
    headers instanceof Headers ? headers.get(k) ?? undefined : headers[k]
  return (
    get('x-trace-id') ??
    get('X-Trace-Id') ??
    get('upstash-message-id') ??
    get('Upstash-Message-Id') ??
    mintTraceId()
  )
}

export function makeRequestLogger(opts: {
  trace_id: string
  tenant_id?: string
  user_id?: string
  route?: string
}): Logger {
  return requestLogger(opts)
}

export { baseLogger as logger }
