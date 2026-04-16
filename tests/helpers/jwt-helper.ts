import { createHmac } from 'node:crypto'
import type { TenantRole } from '@/lib/db/types'

/**
 * Mint a Supabase-compatible JWT for tests. Uses the local JWT secret
 * (default `super-secret-jwt-token-with-at-least-32-characters-long` in
 * Supabase CLI). Populates the custom `tenant_id` and `role` claims that
 * the auth hook would normally add in production.
 */
const DEFAULT_SECRET =
  process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

interface MintOpts {
  userId: string
  email: string
  tenantId: string
  role: TenantRole
  expiresInSec?: number
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export function mintJwt(opts: MintOpts): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    aud: 'authenticated',
    role: 'authenticated', // Supabase-level role (keeps pgrst happy)
    iss: 'supabase-test',
    sub: opts.userId,
    email: opts.email,
    iat: now,
    exp: now + (opts.expiresInSec ?? 3600),
    // Custom claims the auth hook would populate in production
    tenant_id: opts.tenantId,
    // `role` key clashes with Supabase's built-in one, so app reads from app_metadata
    app_metadata: {
      tenant_id: opts.tenantId,
      role: opts.role,
    },
  }
  const h = base64url(JSON.stringify(header))
  const p = base64url(JSON.stringify(payload))
  const sig = base64url(createHmac('sha256', DEFAULT_SECRET).update(`${h}.${p}`).digest())
  return `${h}.${p}.${sig}`
}
