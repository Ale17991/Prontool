import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { TenantRole } from '@/lib/db/types'

export interface ActiveSession {
  userId: string
  email: string | null
  tenantId: string
  role: TenantRole
}

/**
 * Returns the active session or null. Reads tenant_id and role from the
 * custom JWT claims populated by the auth hook.
 */
export async function getSession(): Promise<ActiveSession | null> {
  const supabase = createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return null

  // Pull claims from the raw JWT. @supabase/ssr exposes them on user.app_metadata
  // for custom claims set by auth hooks.
  const claims = (user.app_metadata ?? {}) as {
    tenant_id?: string
    role?: TenantRole
  }

  if (!claims.tenant_id || !claims.role) return null

  return {
    userId: user.id,
    email: user.email ?? null,
    tenantId: claims.tenant_id,
    role: claims.role,
  }
}
