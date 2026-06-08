/**
 * Feature 030 — POST /api/paciente/logout
 *
 * Limpa o cookie de sessão do paciente. Sessão é stateless (HMAC), então
 * "logout" = expirar o cookie no browser.
 */

import { NextResponse } from 'next/server'
import { PATIENT_SESSION_COOKIE_NAME } from '@/lib/core/patient-portal/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true }, { status: 200 })
  res.cookies.set(PATIENT_SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
  return res
}
