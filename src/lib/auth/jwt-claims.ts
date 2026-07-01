import { createHmac, timingSafeEqual } from 'node:crypto'
import type { TenantRole } from '@/lib/db/types'

/**
 * Reads the custom tenant/role claims that the `auth_hook_custom_claims`
 * SQL function injects into `app_metadata`.
 *
 * SECURITY: `decodeJwtClaims` does NOT verify the JWT signature — it only
 * base64-decodes the payload. It is safe ONLY when the token has already been
 * signature-checked upstream (e.g. immediately after `supabase.auth.getUser()`,
 * which validates server-side). For any AUTHORIZATION decision made from a raw
 * cookie/header token, use `verifyAccessToken` below, which validates the HS256
 * signature against `SUPABASE_JWT_SECRET` so a forged/edited payload is rejected.
 */

export interface JwtAppMetadata {
  tenant_id?: string
  role?: TenantRole
}

export interface JwtPayload {
  app_metadata?: JwtAppMetadata
}

export function decodeJwtClaims(token: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const payload = parts[1]
  if (!payload) return null
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '==='.slice((b64.length + 3) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as JwtPayload
  } catch {
    return null
  }
}

export interface VerifiedAccessClaims extends JwtPayload {
  sub?: string
  email?: string
  exp?: number
}

function b64urlToB64(s: string): string {
  return s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
}

/**
 * Verifies the HS256 signature of a Supabase access token against
 * `SUPABASE_JWT_SECRET` and returns the decoded payload, or `null` if the
 * signature is invalid, the secret is missing, or the token is malformed.
 *
 * Use this (never bare `decodeJwtClaims`) whenever the token comes straight
 * from a cookie/header and drives an authorization decision — a forged or
 * edited payload will not pass the signature check.
 *
 * NOTE: expiry (`exp`) is intentionally NOT enforced here. This helper is used
 * for identity RESOLUTION that must survive a momentarily-stale access token
 * (see `platform-admin.ts` — the cookie may lag the middleware refresh). The
 * signature already proves the token was genuinely issued by our auth; the
 * caller always re-checks the actual authority (e.g. `is_super`) against the
 * database, so an authentic-but-stale token cannot elevate privileges.
 */
export function verifyAccessToken(token: string): VerifiedAccessClaims | null {
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

  try {
    return JSON.parse(Buffer.from(b64urlToB64(payloadB64), 'base64').toString('utf8')) as VerifiedAccessClaims
  } catch {
    return null
  }
}
