import { NextResponse } from 'next/server'
import { DomainError } from './errors'
import { logger } from './logger'

export function toHttpResponse(err: unknown, context: Record<string, unknown> = {}): NextResponse {
  if (err instanceof DomainError) {
    logger.warn(
      { ...context, code: err.code, meta: err.meta, message: err.message },
      'domain-error',
    )
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.meta ? { meta: err.meta } : {}) } },
      { status: err.statusHint ?? 400 },
    )
  }

  const message = err instanceof Error ? err.message : String(err)

  // SQLSTATE 23P01 (exclusion_violation) ou mensagem APPOINTMENT_CONFLICT
  // vinda do trigger appointments_create_slot_lock viram HTTP 409.
  // O caller pode ter enriquecido com detalhes em DomainError; aqui e o fallback.
  if (
    /APPOINTMENT_CONFLICT/i.test(message) ||
    /exclusion_violation/i.test(message) ||
    /\b23P01\b/.test(message)
  ) {
    logger.warn({ ...context, message }, 'appointment-conflict')
    return NextResponse.json(
      {
        error: {
          code: 'APPOINTMENT_CONFLICT',
          message: 'Já existe atendimento para este profissional no horário escolhido.',
        },
      },
      { status: 409 },
    )
  }

  logger.error({ ...context, error: message }, 'unhandled-error')
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Algo deu errado. Tente novamente em alguns segundos.',
      },
    },
    { status: 500 },
  )
}
