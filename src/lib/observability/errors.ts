/**
 * Typed domain errors. Each carries a stable `code` used both for
 * HTTP mapping (see http.ts) and for audit/alert dispatcher tagging.
 */

export class DomainError extends Error {
  readonly code: string
  readonly statusHint: number | undefined
  readonly meta: Record<string, unknown> | undefined

  constructor(
    code: string,
    message: string,
    opts: { status?: number; meta?: Record<string, unknown> } = {},
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusHint = opts.status
    this.meta = opts.meta
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('VALIDATION_FAILED', message, meta ? { status: 400, meta } : { status: 400 })
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Sessão inválida ou expirada. Faça login novamente.') {
    super('UNAUTHORIZED', message, { status: 401 })
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Você não tem permissão para esta ação.') {
    super('FORBIDDEN', message, { status: 403 })
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    // Mensagem mantém o nome técnico da entidade para diagnóstico, mas em PT-BR.
    super('NOT_FOUND', `${entity}${id ? ` ${id}` : ''} não encontrado.`, { status: 404 })
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(code, message, meta ? { status: 409, meta } : { status: 409 })
  }
}

export class InvalidSignatureError extends DomainError {
  constructor(message = 'Assinatura inválida.') {
    super('INVALID_SIGNATURE', message, { status: 401 })
  }
}

/** Raised when a webhook payload is missing required custom fields. */
export class WebhookPayloadError extends DomainError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('WEBHOOK_PAYLOAD_INVALID', message, meta ? { meta } : {})
  }
}

/** Raised when (procedure, plan) has no active price at appointment date. */
export class AppointmentPriceMissingError extends DomainError {
  constructor(meta: Record<string, unknown>) {
    super(
      'APPOINTMENT_PRICE_MISSING',
      'Nenhum preço vigente cadastrado para essa combinação de procedimento e plano na data do atendimento.',
      { meta },
    )
  }
}

/** Raised when procedure's TUSS code has been retired. */
export class TussCodeRetiredError extends DomainError {
  constructor(code: string, retiredOn: string) {
    super('TUSS_CODE_RETIRED', `Código TUSS ${code} foi retirado do catálogo em ${retiredOn}.`, {
      meta: { code, retiredOn },
    })
  }
}

/**
 * Raised when an admin tries to create a price version with a stale
 * `expected_head_id` (FR-005a). Carries the current head id so the UI
 * can refresh the form.
 */
export class PriceVersionConflictError extends DomainError {
  constructor(currentHeadId: string | null, currentAmountCents?: number | null) {
    super(
      'PRICE_VERSION_CONFLICT',
      'O preço foi atualizado por outra pessoa. Recarregue a página e tente novamente.',
      {
        status: 409,
        meta: { current_head_id: currentHeadId, current_amount_cents: currentAmountCents },
      },
    )
  }
}

/** Raised when a TUSS validation trigger rejects an insert. */
export class TussCodeInvalidError extends DomainError {
  constructor(code: string, message?: string) {
    super(
      'TUSS_CODE_INVALID',
      message ?? `Código TUSS ${code} é inválido ou foi retirado do catálogo.`,
      {
        status: 400,
        meta: { code },
      },
    )
  }
}
