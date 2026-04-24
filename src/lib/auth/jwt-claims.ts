import type { TenantRole } from '@/lib/db/types'

/**
 * Reads the custom tenant/role claims that the `auth_hook_custom_claims`
 * SQL function (migration 0022) injects into `app_metadata`. We decode the
 * JWT locally rather than relying on `supabase.auth.getUser()` — GoTrue's
 * `/auth/v1/user` only echoes `raw_app_meta_data` from the `auth.users`
 * row, which does not contain hook-added claims. The JWT signature has
 * already been verified by the time this is called (supabase-js refuses
 * to surface a session with a bad signature).
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
