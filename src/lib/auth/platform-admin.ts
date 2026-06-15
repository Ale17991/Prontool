/**
 * Feature 031 — Admin-Agência (usuário de plataforma, cross-tenant).
 *
 * Diferente do RBAC por-tenant (`requireRole`/`can`): aqui é um papel ACIMA
 * dos tenants. A fonte normal é a tabela `platform_admins` (is_super).
 *
 * SOLUÇÃO DEFINITIVA do 404 recorrente do /admin (duas causas observadas):
 *
 *   1. Linha some de `platform_admins` (FK → auth.users ON DELETE CASCADE):
 *      um re-seed/recriação do usuário apaga o vínculo e o dono perde acesso.
 *      → BOOTSTRAP por E-MAIL via env `PLATFORM_SUPER_ADMIN_EMAILS` (com
 *        fallback para o dono). Esses e-mails são super SEMPRE, e a linha é
 *        AUTO-CURADA (upsert) para o auth hook cross-tenant voltar a funcionar.
 *
 *   2. `auth.getUser()` devolve null em Server Component quando o access token
 *      está momentaneamente stale (o middleware renova no response, o render lê
 *      o cookie da request). → resolvemos a identidade decodificando o `sub`/
 *      `email` direto do access_token do cookie (sobrevive a token stale).
 *
 * Fail-closed: sem identidade ⇒ notFound().
 */
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { decodeJwtClaims, type JwtPayload } from '@/lib/auth/jwt-claims'

/** Dono(s) da plataforma por e-mail — super-admin garantido, independe da tabela. */
function bootstrapSuperEmails(): Set<string> {
  const raw = process.env.PLATFORM_SUPER_ADMIN_EMAILS ?? 'operations@homio.com.br'
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  )
}

function isBootstrapSuper(email: string | null | undefined): boolean {
  if (!email) return false
  return bootstrapSuperEmails().has(email.toLowerCase())
}

/** Usuário atual (id + email), resiliente a token stale. Null = não autenticado. */
async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  try {
    const supabase = createSupabaseServerClient()
    // 1) getUser (validado no servidor) — quando o token está fresco.
    const { data: u } = await supabase.auth.getUser()
    if (u.user?.id) return { id: u.user.id, email: u.user.email ?? null }
    // 2) Fallback: sessão local do cookie — decodifica sub/email do access_token.
    //    Sobrevive ao access token momentaneamente stale no Server Component.
    const { data: s } = await supabase.auth.getSession()
    const token = s.session?.access_token
    if (token) {
      const claims = decodeJwtClaims(token) as (JwtPayload & { sub?: string; email?: string }) | null
      const id = claims?.sub ?? s.session?.user?.id
      if (id) return { id, email: claims?.email ?? s.session?.user?.email ?? null }
    }
    return null
  } catch {
    return null
  }
}

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

/** Admin GERAL (is_super) pela TABELA. Fail-closed. */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  try {
    const sb: any = createSupabaseServiceClient()
    const { data, error } = await sb
      .from('platform_admins')
      .select('user_id, is_super')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return false
    return (data as { is_super: boolean }).is_super === true
  } catch {
    return false
  }
}

/**
 * Auto-cura: garante a linha super em `platform_admins` para o dono bootstrap.
 * Mantém o auth hook cross-tenant ("Entrar na clínica") funcionando mesmo após
 * a linha ter sido apagada por cascade. Best-effort — nunca lança.
 */
async function healSuperAdmin(userId: string): Promise<void> {
  try {
    const sb: any = createSupabaseServiceClient()
    await sb
      .from('platform_admins')
      .upsert({ user_id: userId, is_super: true }, { onConflict: 'user_id' })
  } catch {
    // best-effort
  }
}

/** Usuário atual se for super (tabela OU bootstrap por e-mail); senão null. */
export async function superAdminUserId(): Promise<string | null> {
  const user = await currentUser()
  if (!user) return null
  if (await isSuperAdmin(user.id)) return user.id
  if (isBootstrapSuper(user.email)) {
    await healSuperAdmin(user.id)
    return user.id
  }
  return null
}

/** Usuário atual se for Admin-Agência (platform_admin OU bootstrap); senão null. */
export async function platformAdminUserId(): Promise<string | null> {
  const user = await currentUser()
  if (!user) return null
  if (await isPlatformAdmin(user.id)) return user.id
  if (isBootstrapSuper(user.email)) {
    await healSuperAdmin(user.id)
    return user.id
  }
  return null
}

/**
 * Guard para Server Components do painel /admin (qualquer Admin-Agência).
 * Sem identidade ou sem ser admin ⇒ `notFound()` (404 — não revela a rota).
 */
export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const uid = await platformAdminUserId()
  if (!uid) notFound()
  return { userId: uid }
}

/** Guard do painel /admin (gestão): só admin GERAL (is_super) ou dono bootstrap. */
export async function requireSuperAdmin(): Promise<{ userId: string }> {
  const uid = await superAdminUserId()
  if (!uid) notFound()
  return { userId: uid }
}
