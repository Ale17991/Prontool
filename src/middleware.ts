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
  // /cadastros/profissionais. 301 permanente preserva bookmarks.
  // O webhook /api/medicos continua em /api/ (não é afetado por essa rota).
  if (pathname === '/cadastros/medicos' || pathname.startsWith('/cadastros/medicos/')) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = pathname.replace('/cadastros/medicos', '/cadastros/profissionais')
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
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
