import pino, { type Logger } from 'pino'

/**
 * Paths redacted from every log record. Keeps PII (Principle I domain
 * constraint / SC-013) out of application logs even if a caller
 * forgets to strip it.
 */
export const REDACT_CENSOR = '[redacted]'

export const REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-ghl-signature"]',
  'req.headers["x-ghl-timestamp"]',
  'req.headers["upstash-signature"]',
  'req.body.patient.*',
  'req.body.contact.cpf',
  'req.body.contact.name',
  'req.body.contact.full_name',
  'req.body.contact.phone',
  'req.body.contact.email',
  'req.body.contact.birth_date',
  '*.cpf',
  '*.full_name',
  '*.email',
  '*.phone',
  '*.birth_date',
  'patient.cpf',
  'patient.full_name',
  'patient.email',
  'patient.phone',
  'patient.birth_date',
  'webhook_secret',
  'encryption_key',
  'PATIENT_DATA_ENCRYPTION_KEY',
  // Segredos da Memed (Feature 027 / FR-012) — nunca em texto claro nos logs.
  '*.api_key',
  '*.secret_key',
  '*.apiKey',
  '*.secretKey',
  'api_key',
  'secret_key',
  'apiKey',
  'secretKey',
  'config.credentials_enc',
  'credentials_enc',
]

const isDev = process.env.NODE_ENV !== 'production'

const baseOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: REDACTION_PATHS,
    censor: REDACT_CENSOR,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: 'prontool' },
}

export const logger: Logger = isDev
  ? pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
    })
  : pino(baseOptions)

/**
 * Child logger with per-request context (tenant_id, user_id, trace_id).
 */
export function requestLogger(bindings: {
  tenant_id?: string
  user_id?: string
  trace_id: string
  route?: string
}): Logger {
  return logger.child(bindings)
}
