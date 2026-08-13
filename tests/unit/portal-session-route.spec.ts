/**
 * Feature 057 (T036) — POST /api/paciente/sessao.
 *
 * A rota que substituiu a tentativa de renovar no middleware (Edge não tem
 * `node:crypto`). Ela NÃO autentica: estende o que já é válido. O teste existe
 * para que ninguém a transforme, sem perceber, num jeito de reabrir sessão
 * morta — que é exatamente o que o logout precisa que não aconteça.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as renovar } from '@/app/api/paciente/sessao/route'
import {
  PATIENT_SESSION_COOKIE_NAME,
  createPatientSessionCookie,
  verifyPatientSessionCookie,
} from '@/lib/core/patient-portal/session'

const PATIENT = '33333333-3333-3333-3333-333333333333'
const TENANT = '44444444-4444-4444-4444-444444444444'

beforeAll(() => {
  process.env.PATIENT_SESSION_SECRET ??= 'x'.repeat(48)
})

function req(cookieValue: string | null): NextRequest {
  // NextRequest de verdade: a rota lê `request.cookies`, que um `Request` cru
  // não tem — e o teste que usasse o cast silencioso passaria a testar o cast.
  const headers: Record<string, string> = {}
  if (cookieValue !== null) headers.cookie = `${PATIENT_SESSION_COOKIE_NAME}=${cookieValue}`
  return new NextRequest('http://localhost/api/paciente/sessao', { method: 'POST', headers })
}

/** O cookie reemitido, lido do Set-Cookie da resposta. */
function cookieFrom(res: Response): string | null {
  const raw = res.headers.get('set-cookie')
  if (!raw) return null
  const m = new RegExp(`${PATIENT_SESSION_COOKIE_NAME}=([^;]+)`).exec(raw)
  return m ? decodeURIComponent(m[1]!) : null
}

describe('Feature 057 — renovação da sessão do portal', () => {
  it('renova sessão válida e devolve cookie novo', async () => {
    const cookie = createPatientSessionCookie({ patientId: PATIENT, tenantId: TENANT })
    const res = await renovar(req(cookie))

    expect(res.status).toBe(200)
    const renewed = cookieFrom(res)
    expect(renewed).not.toBeNull()

    const payload = verifyPatientSessionCookie(renewed)
    expect(payload?.patientId).toBe(PATIENT)
    expect(payload?.tenantId).toBe(TENANT)
  })

  it('o cookie reemitido é httpOnly — não é lido por script', async () => {
    const cookie = createPatientSessionCookie({ patientId: PATIENT, tenantId: TENANT })
    const res = await renovar(req(cookie))
    expect(res.headers.get('set-cookie')?.toLowerCase()).toContain('httponly')
  })

  it('sem cookie: 401 e nada é emitido', async () => {
    const res = await renovar(req(null))
    expect(res.status).toBe(401)
    expect(cookieFrom(res)).toBeNull()
  })

  it('cookie adulterado: 401 e nada é emitido', async () => {
    const cookie = createPatientSessionCookie({ patientId: PATIENT, tenantId: TENANT })
    const [body] = cookie.split('.')
    const res = await renovar(req(`${body}.0000000000000000`))
    expect(res.status).toBe(401)
    expect(cookieFrom(res)).toBeNull()
  })

  it('depois do logout, não ressuscita a sessão', async () => {
    // O logout limpa o cookie; a requisição seguinte chega sem ele. Se a rota
    // emitisse algo aqui, o paciente não conseguiria sair.
    const res = await renovar(req(''))
    expect(res.status).toBe(401)
    expect(cookieFrom(res)).toBeNull()
  })

  it('não renova sessão expirada — nem por inatividade nem pelo teto', async () => {
    const velha = createPatientSessionCookie({
      patientId: PATIENT,
      tenantId: TENANT,
      nowMs: Date.now() - 60 * 60 * 1000, // 1h atrás: já passou dos 30 min
    })
    const res = await renovar(req(velha))
    expect(res.status).toBe(401)
    expect(cookieFrom(res)).toBeNull()
  })
})
