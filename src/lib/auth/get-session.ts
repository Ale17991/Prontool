import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { decodeJwtClaims } from '@/lib/auth/jwt-claims'
import { logger } from '@/lib/observability/logger'
import type { TenantRole } from '@/lib/db/types'

export interface ActiveSession {
  userId: string
  email: string | null
  tenantId: string
  role: TenantRole
}

/**
 * Returns the active session or null. The `tenant_id` and `role` claims are
 * populated by `auth_hook_custom_claims` (migration 0022) into the JWT's
 * `app_metadata`, but GoTrue's `/auth/v1/user` endpoint only echoes the
 * values persisted on the user row (which don't include hook claims). So
 * after a cheap remote verification that the session exists we extract the
 * claims directly from the access token via `decodeJwtClaims`.
 *
 * Any failure during session resolution (cookies() called outside a
 * request context, Supabase auth unreachable, malformed JWT) resolves to
 * `null`. The caller contract is "null = treat as unauthenticated", so
 * requireRole() turns the null into a proper 401 — failing closed,
 * never into a 500.
 */
export async function getSession(): Promise<ActiveSession | null> {
  try {
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
  } catch (err) {
    logger.debug({ error: err instanceof Error ? err.message : String(err) }, 'get-session-failed')
    return null
  }
}
