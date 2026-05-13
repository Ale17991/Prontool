import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TenantRole } from '@/lib/db/types'
import { createSignedUrlOrNull } from '@/lib/core/storage/signed-url'
import { USER_AVATAR_BUCKET, USER_AVATAR_SIGNED_URL_TTL_SECONDS } from '@/lib/core/user-profile/types'
import type { TeamMember, TeamMemberStatus } from './types'

interface ListInput {
  tenantId: string
  requesterId: string
}

/**
 * Lista todos os usuários vinculados ao tenant. Junta:
 *   - public.user_tenants (status, role)
 *   - auth.admin.getUserById (email, last_sign_in_at, email_confirmed_at)
 *   - public.user_profile (avatar, fullName)
 *
 * Status derivado (R6):
 *   active+confirmed → 'active' | active+!confirmed → 'pending' |
 *   disabled (qualquer) → 'disabled'
 */
export async function listTeamMembers(
  supabaseService: SupabaseClient<Database>,
  input: ListInput,
): Promise<TeamMember[]> {
  // 1. user_tenants do tenant
  const { data: links, error: linksError } = await supabaseService
    .from('user_tenants')
    .select('user_id, role, status')
    .eq('tenant_id', input.tenantId)
  if (linksError) throw new Error(`listTeamMembers links failed: ${linksError.message}`)
  const rows = (links ?? []) as Array<{ user_id: string; role: TenantRole; status: 'active' | 'disabled' }>
  if (rows.length === 0) return []

  // 2. user_profile dos mesmos
  const userIds = rows.map((r) => r.user_id)
  const { data: profiles } = await supabaseService
    .from('user_profile')
    .select('user_id, full_name, avatar_path')
    .in('user_id', userIds)
  const profileByUser = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, p as { user_id: string; full_name: string | null; avatar_path: string | null }]),
  )

  // 3. auth.users metadata (email, last_sign_in_at, email_confirmed_at)
  // O Supabase admin API não tem batch get; iteramos. Para tenants
  // pequenos (≤100) é aceitável.
  const authMeta = new Map<
    string,
    { email: string; last_sign_in_at: string | null; email_confirmed_at: string | null }
  >()
  await Promise.all(
    userIds.map(async (uid) => {
      const { data, error } = await supabaseService.auth.admin.getUserById(uid)
      if (error || !data?.user) return
      authMeta.set(uid, {
        email: data.user.email ?? '',
        last_sign_in_at: data.user.last_sign_in_at ?? null,
        email_confirmed_at: data.user.email_confirmed_at ?? null,
      })
    }),
  )

  // 3b. Feature 012 — doctors vinculados aos mesmos user_ids no tenant.
  const { data: doctorsLinked } = await supabaseService
    .from('doctors')
    .select('id, full_name, user_id')
    .eq('tenant_id', input.tenantId)
    .in('user_id', userIds)
    .eq('active', true)
  const doctorByUser = new Map<string, { id: string; full_name: string }>()
  for (const d of (doctorsLinked ?? []) as Array<{ id: string; full_name: string; user_id: string | null }>) {
    if (d.user_id) doctorByUser.set(d.user_id, { id: d.id, full_name: d.full_name })
  }

  const out: TeamMember[] = await Promise.all(
    rows.map(async (r) => {
      const meta = authMeta.get(r.user_id) ?? { email: '', last_sign_in_at: null, email_confirmed_at: null }
      const profile = profileByUser.get(r.user_id) ?? null
      const status: TeamMemberStatus =
        r.status === 'disabled'
          ? 'disabled'
          : meta.email_confirmed_at
            ? 'active'
            : 'pending'
      const avatarPath = profile?.avatar_path ?? null
      const signedUrl = await createSignedUrlOrNull(
        supabaseService,
        USER_AVATAR_BUCKET,
        avatarPath,
        USER_AVATAR_SIGNED_URL_TTL_SECONDS,
      )
      const linked = doctorByUser.get(r.user_id) ?? null
      return {
        userId: r.user_id,
        email: meta.email,
        fullName: profile?.full_name ?? null,
        avatar: avatarPath ? { path: avatarPath, signedUrl } : null,
        role: r.role,
        status,
        lastSignInAt: meta.last_sign_in_at,
        isSelf: r.user_id === input.requesterId,
        linkedDoctor: linked ? { id: linked.id, fullName: linked.full_name } : null,
      }
    }),
  )

  // Ordena: self primeiro, depois alfabético por nome/email.
  out.sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1
    if (!a.isSelf && b.isSelf) return 1
    const ax = (a.fullName ?? a.email).toLowerCase()
    const bx = (b.fullName ?? b.email).toLowerCase()
    return ax.localeCompare(bx)
  })
  return out
}
