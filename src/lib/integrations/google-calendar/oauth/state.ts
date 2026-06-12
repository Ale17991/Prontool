import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { readStateSigningKey } from './env'

/**
 * Cookie de state (CSRF) do OAuth do Google Calendar. Espelha o padrão da
 * cápsula GHL: assina `{userId, tenantId, nonce, iat}` com HMAC-SHA256 (chave =
 * SUPABASE_JWT_SECRET), grava no cookie HttpOnly; só o `nonce` vai na URL.
 */

export const STATE_COOKIE_NAME = 'gcal_oauth_state'
export const STATE_COOKIE_MAX_AGE_SECONDS = 600

export interface GoogleOAuthStatePayload {
  userId: string
  tenantId: string
  nonce: string
  iatMs: number
}

export class StateMismatchError extends Error {
  readonly code = 'STATE_MISMATCH'
  constructor(reason: string) {
    super(`OAuth state inválido: ${reason}`)
    this.name = 'StateMismatchError'
  }
}
export class StateExpiredError extends Error {
  readonly code = 'STATE_EXPIRED'
  constructor(ageSec: number) {
    super(`OAuth state expirado (idade=${ageSec}s)`)
    this.name = 'StateExpiredError'
  }
}

export function createStateCookie(args: {
  userId: string
  tenantId: string
  nowMs?: number
}): { cookieValue: string; nonce: string } {
  const nonce = randomUUID()
  const payload: GoogleOAuthStatePayload = {
    userId: args.userId,
    tenantId: args.tenantId,
    nonce,
    iatMs: args.nowMs ?? Date.now(),
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { cookieValue: `${body}.${signHex(body)}`, nonce }
}

export function verifyStateCookie(args: {
  cookieValue: string | null
  nonceFromQuery: string | null
  nowMs?: number
}): GoogleOAuthStatePayload {
  if (!args.cookieValue) throw new StateMismatchError('cookie ausente')
  if (!args.nonceFromQuery) throw new StateMismatchError('state ausente na query')

  const lastDot = args.cookieValue.lastIndexOf('.')
  if (lastDot <= 0) throw new StateMismatchError('cookie malformado')
  const body = args.cookieValue.slice(0, lastDot)
  const sig = args.cookieValue.slice(lastDot + 1)

  const expectedSig = signHex(body)
  if (sig.length !== expectedSig.length) throw new StateMismatchError('signature length mismatch')
  if (!timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedSig, 'utf8'))) {
    throw new StateMismatchError('signature mismatch')
  }

  let payload: GoogleOAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GoogleOAuthStatePayload
  } catch {
    throw new StateMismatchError('payload not valid base64url JSON')
  }
  if (
    typeof payload.userId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.nonce !== 'string' ||
    typeof payload.iatMs !== 'number'
  ) {
    throw new StateMismatchError('payload shape inválido')
  }

  const ageSec = Math.floor(((args.nowMs ?? Date.now()) - payload.iatMs) / 1000)
  if (ageSec > STATE_COOKIE_MAX_AGE_SECONDS) throw new StateExpiredError(ageSec)
  if (payload.nonce !== args.nonceFromQuery) throw new StateMismatchError('nonce mismatch')
  return payload
}

function signHex(input: string): string {
  return createHmac('sha256', readStateSigningKey()).update(input).digest('hex')
}
