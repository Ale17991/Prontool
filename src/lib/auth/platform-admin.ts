/**
 * Feature 031 — Admin-Agência (usuário de plataforma, cross-tenant).
 *
 * Diferente do RBAC por-tenant (`requireRole`/`can`): aqui é um papel ACIMA
 * dos tenants. Marcado em `platform_admins` (concessão manual via Supabase).
 *
 * IMPORTANTE: um Admin-Agência pode NÃO ter clínica nenhuma — então NÃO
 * usamos `getSession()` (que exige claim `tenant_id` no JWT e retornaria
 * null). Resolvemos o usuário direto via `auth.getUser()`. A checagem em
 * `platform_admins` usa o service client porque a tabela não é legível por
 * `authenticated` (RLS sem policy). Fail-closed: qualquer erro ⇒ não-admin.
 */
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const sb = createSupabaseServiceClient()
    const { data, error } = await sb
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return false
    return Boolean(data)
  } catch {
    return false
  }
}

/** Usuário autenticado (independe de tenant) ou null. */
async function currentUserId(): Promise<string | null> {
  try {
    const supabase = createSupabaseServerClient()
    const { data } = await supabase.auth.getUser()
    return data.user?.id ?? null
  } catch {
    return null
  }
}

/** Retorna o userId se for Admin-Agência; senão null. Não exige tenant. */
export async function platformAdminUserId(): Promise<string | null> {
  const uid = await currentUserId()
  if (!uid) return null
  return (await isPlatformAdmin(uid)) ? uid : null
}

/**
 * Guard para Server Components do painel /admin. Sem sessão ou sem ser
 * Admin-Agência ⇒ `notFound()` (404 — não revela a existência da rota).
 */
export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const uid = await platformAdminUserId()
  if (!uid) notFound()
  return { userId: uid }
}
