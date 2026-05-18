import { createPublicKey, createVerify } from 'node:crypto'
import { logger } from '@/lib/observability/logger'
import { readGhlSsoEnv } from './env'

/**
 * Feature 008 — Verifica o JWT de contexto SSO entregue pelo GHL no
 * Custom Menu (US5).
 *
 * Implementação minimalista (sem `jose` para preservar zero-novas-deps):
 *   - Suporta apenas alg=RS256.
 *   - Busca JWKS uma vez e cacheia em memória por 1h.
 *   - Usa `crypto.createPublicKey({ key: jwk, format: 'jwk' })` (Node 16+).
 *
 * STATUS: needs-verification-against-official-docs — exato `iss`, `aud`,
 * e claims (`locationId`, `userId`, `userType`) são suposições baseadas
 * em padrões de integrações OIDC similares. Antes da PR final, alinhar
 * contra a doc oficial do GHL Marketplace.
 */

interface Jwk {
  kid?: string
  kty?: string
  alg?: string
  use?: string
  n?: string
  e?: string
}

interface Jwks {
  keys: Jwk[]
}

interface JwtHeader {
  alg: string
  typ?: string
  kid?: string
}

export interface SsoTokenClaims {
  iss?: string
  aud?: string
  exp?: number
  iat?: number
  locationId: string
  userId: string
  userType?: 'Location' | 'Company'
  companyId?: string
  email?: string
}

export class InvalidSsoTokenError extends Error {
  readonly code = 'INVALID_CONTEXT_TOKEN'
  readonly reason: string
  constructor(reason: string) {
    super(`Invalid SSO context token: ${reason}`)
    this.name = 'InvalidSsoTokenError'
    this.reason = reason
  }
}

let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null
const JWKS_TTL_MS = 60 * 60 * 1000 // 1h

const ALLOWED_ISS = [
  'https://services.leadconnectorhq.com',
  'https://marketplace.gohighlevel.com',
]

export async function verifySsoToken(rawToken: string): Promise<SsoTokenClaims> {
  // Env lida por chamada — module-level read pode pegar valor vazio em
  // build/cold-start sem env, e a checagem de aud viraria no-op.
  const { audience: SSO_AUDIENCE } = readGhlSsoEnv()
  const parts = rawToken.split('.')
  if (parts.length !== 3) throw new InvalidSsoTokenError('not a JWS compact')
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string]

  let header: JwtHeader
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8')) as JwtHeader
  } catch {
    throw new InvalidSsoTokenError('header not valid base64url JSON')
  }
  if (header.alg !== 'RS256') {
    throw new InvalidSsoTokenError(`alg ${header.alg} not supported (only RS256)`)
  }

  const jwks = await fetchJwks()
  const jwk = pickJwk(jwks, header.kid)
  if (!jwk) throw new InvalidSsoTokenError(`kid ${header.kid ?? '<none>'} not found in JWKS`)

  const pubKey = createPublicKey({ key: jwk as never, format: 'jwk' })
  const signed = `${headerB64}.${payloadB64}`
  const sigBytes = b64urlDecode(sigB64)
  const verifier = createVerify('RSA-SHA256')
  verifier.update(signed, 'utf8')
  if (!verifier.verify(pubKey, sigBytes)) {
    throw new InvalidSsoTokenError('signature mismatch')
  }

  let claims: SsoTokenClaims
  try {
    claims = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as SsoTokenClaims
  } catch {
    throw new InvalidSsoTokenError('payload not valid base64url JSON')
  }
  const nowSec = Math.floor(Date.now() / 1000)
  // exp é obrigatório — sem ele, um JWT comprometido seria aceito eternamente.
  if (typeof claims.exp !== 'number') {
    throw new InvalidSsoTokenError('exp claim missing')
  }
  if (claims.exp < nowSec) {
    throw new InvalidSsoTokenError('exp in the past')
  }
  if (typeof claims.iat === 'number' && claims.iat > nowSec + 60) {
    throw new InvalidSsoTokenError('iat in the future')
  }
  // aud é obrigatório — sem ele, qualquer JWT assinado pela chave JWKS
  // passaria. SSO_AUDIENCE vem de readGhlSsoEnv() que falha se a env
  // GHL_CLIENT_ID estiver ausente, então aqui está sempre presente.
  if (!claims.aud) {
    throw new InvalidSsoTokenError('aud claim missing')
  }
  if (claims.aud !== SSO_AUDIENCE) {
    throw new InvalidSsoTokenError('aud mismatch')
  }
  if (claims.iss && !ALLOWED_ISS.some((i) => claims.iss === i || claims.iss?.startsWith(i))) {
    throw new InvalidSsoTokenError('iss not allowed')
  }
  if (!claims.locationId) throw new InvalidSsoTokenError('locationId claim missing')
  if (!claims.userId) throw new InvalidSsoTokenError('userId claim missing')

  return claims
}

async function fetchJwks(): Promise<Jwks> {
  const now = Date.now()
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return { keys: jwksCache.keys }
  }
  const env = readGhlSsoEnv()
  const res = await fetch(env.jwksUrl, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) {
    logger.error({ status: res.status, jwksUrl: env.jwksUrl }, 'sso-jwks-fetch-failed')
    throw new InvalidSsoTokenError(`JWKS fetch ${res.status}`)
  }
  const body = (await res.json()) as Jwks
  if (!body || !Array.isArray(body.keys)) {
    throw new InvalidSsoTokenError('JWKS response shape unexpected')
  }
  jwksCache = { fetchedAt: now, keys: body.keys }
  return body
}

function pickJwk(jwks: Jwks, kid: string | undefined): Jwk | null {
  if (kid) {
    const exact = jwks.keys.find((k) => k.kid === kid)
    if (exact) return exact
  }
  // Fallback: única chave RSA disponível.
  const rsa = jwks.keys.find((k) => k.kty === 'RSA')
  return rsa ?? null
}

function b64urlDecode(s: string): Buffer {
  // Pad and convert to standard base64.
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  return Buffer.from(b64, 'base64')
}

/** Para tests: limpa o cache JWKS. */
export function _resetJwksCacheForTests(): void {
  jwksCache = null
}
