import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { TenantRole } from '@/lib/db/types'

export interface ActiveSession {
  userId: string
  email: string | null
  tenantId: string
  role: TenantRole
}

/**
 * Returns the active session or null. The custom `tenant_id` and `role`
 * claims are populated by the `auth_hook_custom_claims` SQL function into
 * the JWT's `app_metadata`, but the GoTrue `/auth/v1/user` endpoint only
 * returns the values persisted on the user row (which don't include hook
 * claims). So after a cheap remote verification that the session exists,
 * we decode the claims directly from the access token.
 */
export async function getSession(): Promise<ActiveSession | null> {
  const supabase = createSupabaseServerClient()
  const [{ data: userData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ])
  const user = userData.user
  const accessToken = sessionData.session?.access_token
  if (!user || !accessToken) return null

  const claims = decodeJwtClaims(accessToken)
  const tenantId = claims?.app_metadata?.tenant_id
  const role = claims?.app_metadata?.role
  if (!tenantId || !role) return null

  return {
    userId: user.id,
    email: user.email ?? null,
    tenantId,
    role,
  }
}

interface JwtAppMetadata {
  tenant_id?: string
  role?: TenantRole
}

interface JwtPayload {
  app_metadata?: JwtAppMetadata
}

function decodeJwtClaims(token: string): JwtPayload | null {
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
