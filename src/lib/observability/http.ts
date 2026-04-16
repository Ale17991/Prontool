import { NextResponse } from 'next/server'
import { DomainError } from './errors'
import { logger } from './logger'

export function toHttpResponse(err: unknown, context: Record<string, unknown> = {}): NextResponse {
  if (err instanceof DomainError) {
    logger.warn({ ...context, code: err.code, meta: err.meta, message: err.message }, 'domain-error')
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.meta ? { meta: err.meta } : {}) } },
      { status: err.statusHint ?? 400 },
    )
  }

  const message = err instanceof Error ? err.message : String(err)
  logger.error({ ...context, error: message }, 'unhandled-error')
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    { status: 500 },
  )
}
