import { createHmac, timingSafeEqual } from 'node:crypto'
import { InvalidSignatureError } from '@/lib/observability/errors'

/**
 * T076 — verify a GHL webhook signature against a tenant's shared secret.
 *
 * Canonical signing form: HMAC-SHA256 over `${timestamp}.${rawBody}` using
 * the tenant's webhook_secret, hex-encoded. This mirrors the form pinned by
 * `tests/helpers/webhook-request.ts` (contract + integration tests).
 *
 * Timestamp skew: reject if `|now - timestamp| > MAX_DRIFT_SECONDS` so
 * replays of old captured payloads fail closed.
 */
const MAX_DRIFT_SECONDS = 5 * 60

export interface VerifyGhlSignatureInput {
  signature: string | null | undefined
  timestamp: string | null | undefined
  rawBody: string
  secret: string
  nowSeconds?: number
}

export function verifyGhlSignature(input: VerifyGhlSignatureInput): void {
  if (!input.signature) throw new InvalidSignatureError('Missing X-GHL-Signature header')
  if (!input.timestamp) throw new InvalidSignatureError('Missing X-GHL-Timestamp header')

  const tsNumber = Number.parseInt(input.timestamp, 10)
  if (!Number.isFinite(tsNumber))
    throw new InvalidSignatureError('Malformed X-GHL-Timestamp header')
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - tsNumber) > MAX_DRIFT_SECONDS) {
    throw new InvalidSignatureError('X-GHL-Timestamp outside allowed drift window')
  }

  const expected = createHmac('sha256', input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest('hex')

  const actual = input.signature
  if (expected.length !== actual.length) throw new InvalidSignatureError()
  const ok = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
  if (!ok) throw new InvalidSignatureError()
}
