import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { readStateSigningKey } from './env'

/**
 * Feature 008 — assinatura/verificação do cookie de OAuth state.
 *
 * Quando o admin clica "Conectar", `authorize/route.ts` cria um payload
 * `{tenant_id, user_id, nonce, iat}`, assina com HMAC-SHA256 (chave =
 * `SUPABASE_JWT_SECRET`) e grava o conjunto no cookie HttpOnly
 * `ghl_oauth_state` (path=/api/oauth/ghl, max-age=600s). O state enviado
 * ao GHL é só o `nonce`.
 *
 * No callback, lemos o cookie, conferimos HMAC, comparamos `nonce` com
 * o que veio na query, validamos idade. Tudo bate ⇒ tenant_id/user_id
 * são confiáveis para o `connect-tenant.ts`.
 */

export const STATE_COOKIE_NAME = 'ghl_oauth_state'
export const STATE_COOKIE_MAX_AGE_SECONDS = 600

export interface OAuthStatePayload {
  tenantId: string
  userId: string
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

/**
 * Produz `{ cookieValue, nonce }`. Caller insere `cookieValue` em
 * `Set-Cookie` e `nonce` no parâmetro `state` da URL do chooselocation.
 */
export function createStateCookie(args: { tenantId: string; userId: string; nowMs?: number }): {
  cookieValue: string
  nonce: string
} {
  const nonce = randomUUID()
  const payload: OAuthStatePayload = {
    tenantId: args.tenantId,
    userId: args.userId,
    nonce,
    iatMs: args.nowMs ?? Date.now(),
  }
  const json = JSON.stringify(payload)
  const body = Buffer.from(json, 'utf8').toString('base64url')
  const sig = signHex(body)
  return { cookieValue: `${body}.${sig}`, nonce }
}

/**
 * Verifica `cookieValue`. Lança `StateMismatchError` se o HMAC falhar
 * ou se o `nonceFromQuery` não bater. Lança `StateExpiredError` se o
 * cookie tem mais de `STATE_COOKIE_MAX_AGE_SECONDS` segundos.
 */
export function verifyStateCookie(args: {
  cookieValue: string | null
  nonceFromQuery: string | null
  nowMs?: number
}): OAuthStatePayload {
  if (!args.cookieValue) throw new StateMismatchError('cookie ausente')
  if (!args.nonceFromQuery) throw new StateMismatchError('state ausente na query')

  const lastDot = args.cookieValue.lastIndexOf('.')
  if (lastDot <= 0) throw new StateMismatchError('cookie malformado')
  const body = args.cookieValue.slice(0, lastDot)
  const sig = args.cookieValue.slice(lastDot + 1)

  const expectedSig = signHex(body)
  if (sig.length !== expectedSig.length) {
    throw new StateMismatchError('signature length mismatch')
  }
  if (!timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedSig, 'utf8'))) {
    throw new StateMismatchError('signature mismatch')
  }

  let payload: OAuthStatePayload
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8')
    payload = JSON.parse(json) as OAuthStatePayload
  } catch {
    throw new StateMismatchError('payload not valid base64url JSON')
  }
  if (
    typeof payload.tenantId !== 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.nonce !== 'string' ||
    typeof payload.iatMs !== 'number'
  ) {
    throw new StateMismatchError('payload shape inválido')
  }

  const now = args.nowMs ?? Date.now()
  const ageSec = Math.floor((now - payload.iatMs) / 1000)
  if (ageSec > STATE_COOKIE_MAX_AGE_SECONDS) {
    throw new StateExpiredError(ageSec)
  }

  if (payload.nonce !== args.nonceFromQuery) {
    throw new StateMismatchError('nonce mismatch')
  }
  return payload
}

function signHex(input: string): string {
  return createHmac('sha256', readStateSigningKey()).update(input).digest('hex')
}
