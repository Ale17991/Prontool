'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { superAdminUserId } from '@/lib/auth/platform-admin'

const PATH = '/admin/suporte'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface AgencyActionResult {
  ok: boolean
  error?: string
}

/**
 * Feature 031 — cria um usuário da AGÊNCIA (admin geral ou suporte). Só super.
 * Cria a conta auth (senha definida) e insere em platform_admins(is_super).
 */
export async function createAgencyUserAction(input: {
  email: string
  password: string
  isSuper: boolean
}): Promise<AgencyActionResult> {
  if (!(await superAdminUserId())) return { ok: false, error: 'Não autorizado.' }
  const email = input.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'E-mail inválido.' }
  if (!input.password || input.password.length < 8) {
    return { ok: false, error: 'Senha mínima de 8 caracteres.' }
  }
  const sb: any = createSupabaseServiceClient()

  // Cria a conta (ou reaproveita se já existe).
  let userId: string | undefined
  const { data: created, error } = await sb.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
  })
  userId = created?.user?.id
  if (!userId) {
    const list = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
    const found = ((list.data?.users ?? []) as Array<{ id: string; email: string | null }>).find(
      (u) => (u.email ?? '').toLowerCase() === email,
    )
    if (!found) return { ok: false, error: error?.message ?? 'Falha ao criar usuário.' }
    userId = found.id
  }

  const { error: insErr } = await sb
    .from('platform_admins')
    .upsert({ user_id: userId, is_super: input.isSuper }, { onConflict: 'user_id' })
  if (insErr) return { ok: false, error: insErr.message }

  revalidatePath(PATH)
  return { ok: true }
}

/** Promove/rebaixa entre admin geral (super) e suporte. Não deixa zero supers. */
export async function setAgencySuperAction(
  userId: string,
  isSuper: boolean,
): Promise<AgencyActionResult> {
  if (!(await superAdminUserId())) return { ok: false, error: 'Não autorizado.' }
  const sb: any = createSupabaseServiceClient()
  if (!isSuper) {
    const { data } = await sb.from('platform_admins').select('user_id').eq('is_super', true)
    const supers = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
    if (supers.length <= 1 && supers.includes(userId)) {
      return { ok: false, error: 'Não pode rebaixar o último admin geral.' }
    }
  }
  const { error } = await sb
    .from('platform_admins')
    .update({ is_super: isSuper })
    .eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(PATH)
  return { ok: true }
}

/** Remove o acesso de agência (não apaga a conta auth — pode ser usuário de clínica). */
export async function removeAgencyAdminAction(userId: string): Promise<AgencyActionResult> {
  if (!(await superAdminUserId())) return { ok: false, error: 'Não autorizado.' }
  const sb: any = createSupabaseServiceClient()
  const { data } = await sb.from('platform_admins').select('user_id, is_super')
  const all = (data ?? []) as Array<{ user_id: string; is_super: boolean }>
  const target = all.find((a) => a.user_id === userId)
  if (!target) return { ok: false, error: 'Usuário não encontrado.' }
  if (target.is_super && all.filter((a) => a.is_super).length <= 1) {
    return { ok: false, error: 'Não pode remover o último admin geral.' }
  }
  await sb.from('platform_admin_tenants').delete().eq('user_id', userId)
  const { error } = await sb.from('platform_admins').delete().eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(PATH)
  return { ok: true }
}
