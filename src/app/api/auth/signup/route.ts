import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { signupAccount } from '@/lib/core/auth/signup'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 010 (US2) — POST /api/auth/signup
 *
 * Cadastro público (FR-009). NÃO exige sessão; AUTH_EXEMPT em
 * `scripts/check-require-role.mjs`.
 *
 * Pipeline:
 *   1. Zod valida payload (signupSchema).
 *   2. auth.admin.createUser via service client.
 *   3. Toda falha de auth.admin vira 409 SIGNUP_FAILED com mensagem
 *      genérica (FR-011 — anti-enumeration).
 *
 * Cliente: depois de 201, chama supabase.auth.signInWithPassword e
 * redireciona para /onboarding.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}))
    const supabase = createSupabaseServiceClient()
    const result = await signupAccount(supabase, body, {
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json({ ok: true, userId: result.userId }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: 'POST /api/auth/signup' })
  }
}
