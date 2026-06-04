/**
 * Feature 030 — POST /api/paciente/login
 *
 * Rota PÚBLICA (sem requireRole de staff — exceção registrada em
 * scripts/check-require-role.mjs). Pipeline:
 *   1. Zod (slug, cpf 11 dígitos, nascimento DDMMYYYY, consentimento LGPD)
 *   2. verifyPatientLogin (resolve clínica + rate-limit + RPC + audit)
 *   3. casou → Set-Cookie HMAC (httpOnly, SameSite=Strict, ~30min)
 *
 * Falha de credencial é SEMPRE 401 genérico — nunca revela se o CPF
 * existe (FR-019). Rate-limit estourado → 429 + Retry-After (FR-017).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { verifyPatientLogin } from '@/lib/core/patient-portal/login'
import {
  createPatientSessionCookie,
  PATIENT_SESSION_COOKIE_NAME,
  PATIENT_SESSION_MAX_AGE_SECONDS,
} from '@/lib/core/patient-portal/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const digits = (s: string) => s.replace(/\D/g, '')

const BodySchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,31}$/),
  cpf: z.string().transform(digits).pipe(z.string().regex(/^\d{11}$/)),
  /** Data de nascimento só números, DDMMYYYY (ex.: 15051990). */
  birthdate: z.string().transform(digits).pipe(z.string().regex(/^\d{8}$/)),
  lgpd_consent: z.literal(true),
})

function extractIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

const GENERIC_FAIL = {
  error: {
    code: 'INVALID_CREDENTIALS',
    message: 'CPF ou data de nascimento inválidos.',
  },
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(GENERIC_FAIL, { status: 401 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    // Consentimento ausente é o único erro distinguível (UX); o resto é genérico.
    const consentIssue = parsed.error.issues.some((i) => i.path[0] === 'lgpd_consent')
    if (consentIssue) {
      return NextResponse.json(
        { error: { code: 'CONSENT_REQUIRED', message: 'Aceite o aviso de privacidade para continuar.' } },
        { status: 400 },
      )
    }
    return NextResponse.json(GENERIC_FAIL, { status: 401 })
  }

  const supabase = createSupabaseServiceClient()
  const result = await verifyPatientLogin({
    supabase,
    slug: parsed.data.slug,
    cpf: parsed.data.cpf,
    birthdate: parsed.data.birthdate,
    ip: extractIp(request),
    userAgent: request.headers.get('user-agent'),
  })

  switch (result.status) {
    case 'clinic_not_found':
      return NextResponse.json({ error: { code: 'CLINIC_NOT_FOUND' } }, { status: 404 })
    case 'rate_limited':
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
          },
          retryAfter: result.retryAfterSec,
        },
        { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } },
      )
    case 'invalid':
      return NextResponse.json(GENERIC_FAIL, { status: 401 })
    case 'ok': {
      const cookieValue = createPatientSessionCookie({
        patientId: result.patientId,
        tenantId: result.tenantId,
      })
      const res = NextResponse.json({ ok: true }, { status: 200 })
      res.cookies.set(PATIENT_SESSION_COOKIE_NAME, cookieValue, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: PATIENT_SESSION_MAX_AGE_SECONDS,
      })
      return res
    }
  }
}
