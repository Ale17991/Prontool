import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { IMPERSONATION_COOKIE, MUTATING_METHODS } from '@/lib/core/auth/impersonation'

/**
 * Feature 010 (R9) — tabela de redirecionamentos de auth-vs-tenant.
 *
 *   | sessão                              | rota acessada     | ação               |
 *   |-------------------------------------|-------------------|--------------------|
 *   | não autenticado                     | (dashboard)/*     | -> /login          |
 *   | autenticado sem claim tenant_id     | (dashboard)/*     | -> /onboarding     |
 *   | autenticado com tenant ativo        | /login, /registrar, /onboarding | -> /operacao/atendimentos |
 *
 * Detecção do tenant_id: middleware decodifica o JWT do cookie de sessão
 * (sem verificar assinatura — getUser já fez essa verificação acima). Se
 * `app_metadata.tenant_id` está populado, há tenant ativo; senão, não há.
 */

const AUTH_FREE_ROUTES = ['/login', '/registrar']
const ONBOARDING_ROUTE = '/onboarding'
const SELECTOR_ROUTE = '/selecionar-clinica'
const DASHBOARD_DEFAULT = '/operacao/atendimentos'

function isAuthRoute(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/registrar' ||
    pathname === ONBOARDING_ROUTE ||
    pathname === SELECTOR_ROUTE ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/registrar/') ||
    pathname.startsWith(`${ONBOARDING_ROUTE}/`) ||
    pathname.startsWith(`${SELECTOR_ROUTE}/`)
  )
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/')
}

/**
 * Feature 031 — painel Admin-Agência (papel de plataforma, cross-tenant). Passa
 * pelo refresh de sessão (senão o token expira e a página 404a), mas NÃO pelo
 * gate de tenant/onboarding — um Admin-Agência pode não ter clínica nenhuma.
 */
function isAdminRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

function decodeJwtTenantId(accessToken: string | null): string | null {
  if (!accessToken) return null
  const parts = accessToken.split('.')
  if (parts.length !== 3) return null
  const middle = parts[1]
  if (!middle) return null
  try {
    const payload = JSON.parse(
      Buffer.from(middle.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { app_metadata?: { tenant_id?: string } }
    return payload?.app_metadata?.tenant_id ?? null
  } catch {
    return null
  }
}

/**
 * Feature 043 (US5) — detecta sessão de impersonação pelo claim
 * `app_metadata.impersonation` que o auth hook (0167) injeta no caminho
 * cross-tenant (1b). É a garantia read-only À PROVA de adulteração: o claim
 * viaja no JWT ASSINADO, então apagar o cookie `clinni_impersonation` não o
 * remove; um JWT com o claim removido teria assinatura inválida (rejeitado
 * pela RLS/PostgREST no data layer). Decode sem verificar assinatura é seguro
 * aqui porque a decisão é BLOQUEAR (fail-safe) e um token forjado sem o claim
 * não escreve no banco de qualquer forma.
 */
function isImpersonationJwt(req: NextRequest): boolean {
  try {
    const parts = req.cookies
      .getAll()
      .filter((c) => /sb-.*-auth-token(\.\d+)?$/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (parts.length === 0) return false
    let raw = parts.map((c) => c.value).join('')
    if (raw.startsWith('base64-')) raw = raw.slice('base64-'.length)
    let session: unknown
    try {
      session = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    } catch {
      try {
        session = JSON.parse(raw)
      } catch {
        return false
      }
    }
    const s = session as { access_token?: unknown } | unknown[]
    const token =
      typeof (s as { access_token?: unknown }).access_token === 'string'
        ? (s as { access_token: string }).access_token
        : Array.isArray(s) && typeof s[0] === 'string'
          ? (s[0] as string)
          : null
    const middle = token?.split('.')[1]
    if (!middle) return false
    const payload = JSON.parse(
      Buffer.from(middle.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { app_metadata?: { impersonation?: boolean } }
    return payload?.app_metadata?.impersonation === true
  } catch {
    return false
  }
}

/**
 * Refreshes the Supabase auth session on every request and relays the
 * updated cookies into the response. Without this middleware, Server
 * Components that call `getSession()` see a stale (or missing) session
 * because cookies set by the browser client only become readable after
 * the SSR server has been told about them.
 *
 * Public routes (/login, /api/webhooks/*, /api/workers/*) skip the
 * refresh — those endpoints either run unauthenticated by design or
 * verify their own signatures.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rebrand 2026-04: /cadastros/medicos foi renomeado pra
  // /configuracoes/profissionais. 301 permanente preserva bookmarks.
  // O webhook /api/medicos continua em /api/ (não é afetado por essa rota).
  if (pathname === '/cadastros/medicos' || pathname.startsWith('/cadastros/medicos/')) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = pathname.replace('/cadastros/medicos', '/configuracoes/profissionais')
    return NextResponse.redirect(redirectUrl, 301)
  }

  // Feature 009 — reorganização da navegação (US2). Os itens de Cadastros
  // migraram para /configuracoes/* (catálogos) e /analise/despesas. 301
  // permanente preserva bookmarks/links externos por tempo indefinido
  // (FR-021, SC-004).
  const CADASTROS_REDIRECTS: Array<readonly [string, string]> = [
    ['/cadastros/procedimentos', '/configuracoes/procedimentos'],
    ['/cadastros/planos', '/configuracoes/convenios'],
    ['/cadastros/profissionais', '/configuracoes/profissionais'],
    ['/cadastros/anamnese', '/configuracoes/modelos-anamnese'],
    ['/cadastros/precos', '/configuracoes/precos'],
    ['/cadastros/despesas', '/analise/despesas'],
  ]
  for (const [from, to] of CADASTROS_REDIRECTS) {
    if (pathname === from || pathname.startsWith(`${from}/`)) {
      const redirectUrl = req.nextUrl.clone()
      redirectUrl.pathname = pathname.replace(from, to)
      return NextResponse.redirect(redirectUrl, 301)
    }
  }
  if (pathname === '/cadastros') {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/configuracoes'
    return NextResponse.redirect(redirectUrl, 301)
  }

  // Self-signup desabilitado: cadastro de novas clinicas e' feito por
  // convite/onboarding controlado. Qualquer acesso direto a /registrar
  // volta pro login; o endpoint POST do signup retorna 403.
  if (pathname === '/registrar' || pathname.startsWith('/registrar/')) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }
  if (pathname === '/api/auth/signup') {
    return new NextResponse(JSON.stringify({ error: 'SIGNUP_DISABLED' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Feature 043 (US5) — impersonação READ-ONLY: enquanto o super-admin estiver
  // impersonando uma clínica, TODA escrita é bloqueada no servidor (rotas /api/*
  // e Server Actions, ambas POST). Exceto o controle da própria impersonação e o
  // logout. Leitura (GET/HEAD) passa normalmente.
  //
  // O sinal é o claim `app_metadata.impersonation` do JWT (assinado, inviolável
  // — 0167) OU o cookie clinni_impersonation (cobre a janela entre start e o
  // refreshSession do cliente, antes do claim aparecer no token). Apagar o
  // cookie NÃO libera escrita: o claim permanece no JWT.
  if (
    // Checagens baratas primeiro (curto-circuito): só decodifica o JWT p/ achar
    // o claim de impersonação em ESCRITA a rota não-isenta e sem o cookie.
    MUTATING_METHODS.has(req.method) &&
    // O painel da plataforma (/admin e suas Server Actions/APIs) é do
    // super-admin — NUNCA é impersonado, então nunca é bloqueado.
    !pathname.startsWith('/admin') &&
    !pathname.startsWith('/api/admin/') &&
    !pathname.startsWith('/api/auth/logout') &&
    (req.cookies.get(IMPERSONATION_COOKIE)?.value || isImpersonationJwt(req))
  ) {
    return new NextResponse(
      JSON.stringify({
        error: { code: 'IMPERSONATION_READ_ONLY', message: 'Sessão de suporte é somente-leitura.' },
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/workers') ||
    // Logout limpa os cookies de sessão — o refresh do middleware não pode
    // re-setá-los e atrapalhar o sign-out.
    pathname.startsWith('/api/auth/logout') ||
    pathname.startsWith('/agendar') ||
    // Recuperação de senha: chega com a sessão de recovery no hash (client-side);
    // precisa ser pública senão o middleware redireciona pro /login antes do
    // browser client processar o token.
    pathname.startsWith('/redefinir-senha') ||
    // Backlog 1/3 — auto-cadastro do paciente: página + API públicas (token).
    pathname.startsWith('/completar-cadastro') ||
    pathname.startsWith('/api/public/') ||
    // Backlog 1/4/3 — verificação pública de documento (QR).
    pathname.startsWith('/verificar') ||
    pathname.startsWith('/api/verificar') ||
    // Feature 030 — portal do paciente: público, com sessão própria (cookie
    // HMAC verificado na página/endpoint, não aqui). O prefixo com '/' em
    // /api/paciente/ evita capturar /api/pacientes (staff, requireRole).
    pathname.startsWith('/paciente/') ||
    pathname === '/paciente' ||
    pathname.startsWith('/api/paciente/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const res = NextResponse.next()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return res

  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value
      },
      set(name: string, value: string, options: CookieOptions) {
        res.cookies.set({ name, value, ...options })
      },
      remove(name: string, options: CookieOptions) {
        res.cookies.set({ name, value: '', ...options })
      },
    },
  })

  // Touching getUser refreshes the session and triggers cookie writes
  // on the response when the access token rotates.
  //
  // Defense in depth: se getUser()/getSession() jogar exception (cookie
  // malformed, refresh falhando, supabase unreachable), middleware NÃO
  // pode quebrar a rota — só "fica neutro" e devolve `res`. Sem isso, um
  // bug em supabase-js vira 500 universal.
  let isAuthed = false
  let hasTenant = false
  try {
    const { data: userData } = await supabase.auth.getUser()
    isAuthed = userData.user !== null
    if (isAuthed && !isApiRoute(pathname)) {
      const { data: sessionData } = await supabase.auth.getSession()
      hasTenant = decodeJwtTenantId(sessionData.session?.access_token ?? null) !== null
    }
  } catch {
    return res
  }

  // Feature 010 (R9) — redirects baseados em (autenticação × tenant ativo ×
  // rota). Roda só em rotas server-rendered (não /api/*, não _next, não
  // estáticos), pra não interferir com endpoints de auth.
  if (!isApiRoute(pathname)) {
    // Não autenticado em rota interna -> /login.
    if (!isAuthed && !isAuthRoute(pathname)) {
      const redirectUrl = req.nextUrl.clone()
      redirectUrl.pathname = '/login'
      redirectUrl.search = ''
      return NextResponse.redirect(redirectUrl)
    }

    // Autenticado sem tenant em rota dashboard -> /onboarding.
    // /admin é exceção: Admin-Agência pode não ter clínica; a própria rota
    // valida via requireSuperAdmin (404 para não-admin).
    if (isAuthed && !hasTenant && !isAuthRoute(pathname) && !isAdminRoute(pathname)) {
      const redirectUrl = req.nextUrl.clone()
      redirectUrl.pathname = ONBOARDING_ROUTE
      redirectUrl.search = ''
      return NextResponse.redirect(redirectUrl)
    }

    // Autenticado com tenant em rota de auth -> dashboard.
    if (isAuthed && hasTenant && AUTH_FREE_ROUTES.concat([ONBOARDING_ROUTE]).includes(pathname)) {
      const redirectUrl = req.nextUrl.clone()
      redirectUrl.pathname = DASHBOARD_DEFAULT
      redirectUrl.search = ''
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Feature 008: quando a sessão veio do SSO do GHL, permite iframe
  // pelo domínio gohighlevel.com via CSP frame-ancestors. Sem o cookie
  // marker, mantém default seguro (frame-ancestors 'none' aplicado por
  // outras camadas).
  const ssoOrigin = req.cookies.get('clinni_sso_origin')?.value
  if (ssoOrigin === 'ghl') {
    res.headers.set(
      'Content-Security-Policy',
      'frame-ancestors https://app.gohighlevel.com https://*.gohighlevel.com',
    )
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
