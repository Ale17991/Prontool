/**
 * Feature 031 — Admin-Agência (usuário de plataforma, cross-tenant).
 *
 * Diferente do RBAC por-tenant (`requireRole`/`can`): aqui é um papel ACIMA
 * dos tenants. Marcado em `platform_admins` (concessão manual via Supabase).
 * A checagem usa o service client porque a tabela não é legível por
 * `authenticated` (RLS sem policy). Fail-closed: qualquer erro ⇒ não-admin.
 */
import { notFound } from 'next/navigation'
import { getSession, type ActiveSession } from '@/lib/auth/get-session'
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

/**
 * Guard para Server Components do painel /admin. Sem sessão ou sem ser
 * Admin-Agência ⇒ `notFound()` (404 — não revela a existência da rota).
 */
export async function requirePlatformAdmin(): Promise<{ session: ActiveSession }> {
  const session = await getSession()
  if (!session) notFound()
  if (!(await isPlatformAdmin(session.userId))) notFound()
  return { session }
}
