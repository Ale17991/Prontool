import { createHmac, timingSafeEqual } from 'node:crypto'
import type { TenantRole } from '@/lib/db/types'
import type { ActiveSession } from './get-session'
import { getSession } from './get-session'

/**
 * Resolves an `ActiveSession` for a Route Handler that may be called either
 * from the browser (cookie-based session via `getSession()`) or from a
 * server-to-server caller / test that passes `Authorization: Bearer <jwt>`.
 *
 * The bearer path verifies the JWT against `SUPABASE_JWT_SECRET` so we
 * can't be tricked by a forged token, then reads the same custom claims
 * (`tenant_id`, `role`) the auth hook populates in production.
 */
export async function getSessionFromRequest(req: Request): Promise<ActiveSession | null> {
  const auth = req.headers.get('authorization')
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice('bearer '.length).trim()
    const session = decodeAndVerifyJwt(token)
    if (session) return session
  }
  return getSession()
}

interface JwtClaims {
  sub?: string
  email?: string
  exp?: number
  tenant_id?: string
  app_metadata?: { tenant_id?: string; role?: TenantRole }
}

function decodeAndVerifyJwt(token: string): ActiveSession | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string]

  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return null

  const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
  let provided: Buffer
  try {
    provided = Buffer.from(b64urlToB64(sigB64), 'base64')
  } catch {
    return null
  }
  if (expected.length !== provided.length) return null
  if (!timingSafeEqual(expected, provided)) return null

  let claims: JwtClaims
  try {
    claims = JSON.parse(
      Buffer.from(b64urlToB64(payloadB64), 'base64').toString('utf8'),
    ) as JwtClaims
  } catch {
    return null
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null

  const tenantId = claims.app_metadata?.tenant_id ?? claims.tenant_id
  const role = claims.app_metadata?.role
  const userId = claims.sub
  if (!tenantId || !role || !userId) return null

  return {
    userId,
    email: claims.email ?? null,
    tenantId,
    role,
  }
}

function b64urlToB64(s: string): string {
  return s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
}
