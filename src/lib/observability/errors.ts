/**
 * Typed domain errors. Each carries a stable `code` used both for
 * HTTP mapping (see http.ts) and for audit/alert dispatcher tagging.
 */

export class DomainError extends Error {
  readonly code: string
  readonly statusHint?: number
  readonly meta?: Record<string, unknown>

  constructor(code: string, message: string, opts: { status?: number; meta?: Record<string, unknown> } = {}) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusHint = opts.status
    this.meta = opts.meta
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('VALIDATION_FAILED', message, { status: 400, meta })
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Not authenticated') {
    super('UNAUTHORIZED', message, { status: 401 })
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, { status: 403 })
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', `${entity} ${id ?? ''} not found`, { status: 404 })
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(code, message, { status: 409, meta })
  }
}

export class InvalidSignatureError extends DomainError {
  constructor(message = 'Invalid signature') {
    super('INVALID_SIGNATURE', message, { status: 401 })
  }
}

/** Raised when a webhook payload is missing required custom fields. */
export class WebhookPayloadError extends DomainError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('WEBHOOK_PAYLOAD_INVALID', message, { meta })
  }
}

/** Raised when (procedure, plan) has no active price at appointment date. */
export class AppointmentPriceMissingError extends DomainError {
  constructor(meta: Record<string, unknown>) {
    super('APPOINTMENT_PRICE_MISSING', 'No active price for (procedure, plan) at appointment date', { meta })
  }
}

/** Raised when procedure's TUSS code has been retired. */
export class TussCodeRetiredError extends DomainError {
  constructor(code: string, retiredOn: string) {
    super('TUSS_CODE_RETIRED', `TUSS code ${code} retired on ${retiredOn}`, { meta: { code, retiredOn } })
  }
}
