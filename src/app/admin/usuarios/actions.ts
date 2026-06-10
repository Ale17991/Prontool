'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { isSuperAdmin } from '@/lib/auth/platform-admin'
import { setTeamMemberRole } from '@/lib/core/team/set-role'
import { setTeamMemberStatus } from '@/lib/core/team/set-status'
import { createManualUser } from '@/lib/core/team/create-manual'
import { inviteTeamMember } from '@/lib/core/team/invite'
import type { Database } from '@/lib/db/types'

export interface AdminUserActionResult {
  ok: boolean
  error?: string
  /** Para reset de senha: link de redefinição (copiar/enviar ao usuário). */
  link?: string
}

const PATH = '/admin/usuarios'

/** Garante admin GERAL e devolve o ator (para auditoria). null = não autorizado. */
async function superCtx(): Promise<{ actorId: string; actorEmail: string | null } | null> {
  const supabase = createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user || !(await isSuperAdmin(user.id))) return null
  return { actorId: user.id, actorEmail: user.email ?? null }
}

function svc(): SupabaseClient<Database> {
  return createSupabaseServiceClient() as unknown as SupabaseClient<Database>
}

function fail(e: unknown): AdminUserActionResult {
  return { ok: false, error: e instanceof Error ? e.message : String(e) }
}

export async function adminSetRoleAction(
  tenantId: string,
  targetUserId: string,
  role: string,
): Promise<AdminUserActionResult> {
  const ctx = await superCtx()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    await setTeamMemberRole(svc(), tenantId, ctx.actorId, ctx.actorEmail, targetUserId, { role })
    revalidatePath(PATH)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function adminSetStatusAction(
  tenantId: string,
  targetUserId: string,
  status: 'active' | 'disabled',
): Promise<AdminUserActionResult> {
  const ctx = await superCtx()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    await setTeamMemberStatus(svc(), tenantId, ctx.actorId, ctx.actorEmail, targetUserId, { status })
    revalidatePath(PATH)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function adminEditNameAction(
  targetUserId: string,
  fullName: string,
): Promise<AdminUserActionResult> {
  const ctx = await superCtx()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  const name = fullName.trim()
  if (name.length < 1 || name.length > 200) return { ok: false, error: 'Nome inválido.' }
  const sb: any = svc()
  const { error } = await sb
    .from('user_profile')
    .upsert({ user_id: targetUserId, full_name: name }, { onConflict: 'user_id' })
  if (error) return { ok: false, error: error.message }
  revalidatePath(PATH)
  return { ok: true }
}

export async function adminResetPasswordAction(
  targetUserId: string,
): Promise<AdminUserActionResult> {
  const ctx = await superCtx()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  const sb: any = svc()
  const { data: u } = await sb.auth.admin.getUserById(targetUserId)
  const email = u?.user?.email
  if (!email) return { ok: false, error: 'Usuário sem e-mail.' }
  const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email })
  if (error) return { ok: false, error: error.message }
  return { ok: true, link: data?.properties?.action_link ?? undefined }
}

export async function adminCreateUserAction(
  tenantId: string,
  input: { fullName: string; email: string; password: string; role: string },
): Promise<AdminUserActionResult> {
  const ctx = await superCtx()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    await createManualUser(svc(), tenantId, ctx.actorId, ctx.actorEmail, {
      full_name: input.fullName,
      email: input.email,
      password: input.password,
      role: input.role,
    })
    revalidatePath(PATH)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function adminInviteUserAction(
  tenantId: string,
  input: { email: string; role: string },
): Promise<AdminUserActionResult> {
  const ctx = await superCtx()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    await inviteTeamMember(svc(), tenantId, ctx.actorId, ctx.actorEmail, {
      email: input.email,
      role: input.role,
    })
    revalidatePath(PATH)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
