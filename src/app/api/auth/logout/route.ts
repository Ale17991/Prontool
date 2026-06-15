import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'

/**
 * GET /api/auth/logout — desloga a sessão de staff e redireciona pro login.
 *
 * Usado quando um usuário sem permissão cai numa rota restrita (ex.: /admin):
 * em vez de uma 404 morta, deslogamos e mandamos pro /login pra logar com a
 * conta certa. Público por design (qualquer um pode se deslogar) — sem
 * requireRole (registrado em check-require-role AUTH_EXEMPT_PREFIXES).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  const supabase = createSupabaseServerClient()
  try {
    await supabase.auth.signOut()
  } catch {
    // best-effort — mesmo se falhar, segue pro login (cookies já limpos ou não).
  }
  const url = new URL(req.url)
  const next = url.searchParams.get('next')
  // Só caminhos internos (evita open-redirect).
  const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/login'
  return NextResponse.redirect(new URL(safe, url.origin), { status: 303 })
}
