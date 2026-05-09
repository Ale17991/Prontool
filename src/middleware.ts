import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/workers') ||
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
  await supabase.auth.getUser()

  // Feature 008: quando a sessão veio do SSO do GHL, permite iframe
  // pelo domínio gohighlevel.com via CSP frame-ancestors. Sem o cookie
  // marker, mantém default seguro (frame-ancestors 'none' aplicado por
  // outras camadas).
  const ssoOrigin = req.cookies.get('prontool_sso_origin')?.value
  if (ssoOrigin === 'ghl') {
    res.headers.set(
      'Content-Security-Policy',
      "frame-ancestors https://app.gohighlevel.com https://*.gohighlevel.com",
    )
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
