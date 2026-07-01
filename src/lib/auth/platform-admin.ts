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
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { verifyAccessToken, type JwtPayload } from '@/lib/auth/jwt-claims'

type AccessClaims = JwtPayload & { sub?: string; email?: string }

/**
 * Identidade lida DIRETO do cookie de auth do Supabase (sb-<ref>-auth-token,
 * possivelmente em chunks .0/.1). Decodifica o access_token e extrai sub/email.
 * É o caminho mais robusto em Server Component: independe de `getUser()` (que
 * devolve null com token stale) e do refresh do middleware. Só lê o `sub`/
 * `email` — a autoridade (is_super) é cruzada com o banco depois.
 *
 * SEGURANÇA: o access_token é VERIFICADO (`verifyAccessToken`, assinatura HS256
 * contra `SUPABASE_JWT_SECRET`) antes de confiar em qualquer claim. Sem isso um
 * usuário poderia forjar o `email` no cookie e virar super-admin (bootstrap).
 */
function identityFromCookies(): { id: string; email: string | null } | null {
  try {
    const jar = cookies()
    const parts = jar
      .getAll()
      .filter((c) => /sb-.*-auth-token(\.\d+)?$/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (parts.length === 0) return null
    let raw = parts.map((c) => c.value).join('')
    if (raw.startsWith('base64-')) raw = raw.slice('base64-'.length)

    let session: unknown = null
    try {
      session = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    } catch {
      try {
        session = JSON.parse(raw)
      } catch {
        return null
      }
    }
    const s = session as { access_token?: unknown } | unknown[]
    const accessToken =
      typeof (s as { access_token?: unknown }).access_token === 'string'
        ? ((s as { access_token: string }).access_token)
        : Array.isArray(s) && typeof s[0] === 'string'
          ? (s[0] as string)
          : null
    if (!accessToken) return null
    const claims = verifyAccessToken(accessToken) as AccessClaims | null
    if (!claims?.sub) return null
    return { id: claims.sub, email: claims.email ?? null }
  } catch {
    return null
  }
}

/** Dono(s) da plataforma por e-mail — super-admin garantido, independe da tabela. */
function bootstrapSuperEmails(): Set<string> {
  const raw =
    process.env.PLATFORM_SUPER_ADMIN_EMAILS ??
    'clinnipro@gmail.com,operations@homio.com.br'
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
  // 1) Cookie direto — o mais robusto em Server Component (imune a token stale).
  const fromCookie = identityFromCookies()
  if (fromCookie) return fromCookie

  // 2) supabase-js — getUser (fresco) e depois getSession.
  try {
    const supabase = createSupabaseServerClient()
    const { data: u } = await supabase.auth.getUser()
    if (u.user?.id) return { id: u.user.id, email: u.user.email ?? null }
    const { data: s } = await supabase.auth.getSession()
    const token = s.session?.access_token
    if (token) {
      // getSession() reads storage without server-side signature validation
      // (getUser above already failed), so verify before trusting claims.
      const claims = verifyAccessToken(token) as AccessClaims | null
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
 * UX (pedido do dono): em vez de uma tela 404 morta, quem não é admin é
 * DESLOGADO e mandado pro /login — assim dá pra logar com a conta certa. Não
 * autenticado vai direto pro login (nada a deslogar). `redirect()` lança o
 * NEXT_REDIRECT que o Next trata.
 */
function bounceToLogin(loggedIn: boolean): never {
  redirect(loggedIn ? '/api/auth/logout?next=/login' : '/login')
}

async function grantOrBounce(
  check: (userId: string) => Promise<boolean>,
): Promise<{ userId: string }> {
  const user = await currentUser()
  if (!user) bounceToLogin(false)
  if ((await check(user.id)) || isBootstrapSuper(user.email)) {
    if (isBootstrapSuper(user.email)) await healSuperAdmin(user.id)
    return { userId: user.id }
  }
  bounceToLogin(true)
}

/** Guard para Server Components do painel /admin (qualquer Admin-Agência). */
export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  return grantOrBounce(isPlatformAdmin)
}

/** Guard do painel /admin (gestão): só admin GERAL (is_super) ou dono bootstrap. */
export async function requireSuperAdmin(): Promise<{ userId: string }> {
  return grantOrBounce(isSuperAdmin)
}
