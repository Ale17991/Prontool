/**
 * Feature 057 — POST /api/paciente/sessao — renova a janela de inatividade.
 *
 * O portal deixou de ser uma tela só. Com a navegação entre áreas, uma sessão de
 * 30 minutos contados do login passaria a cortar um percurso, e não uma tela —
 * por isso os 30 minutos viraram janela de INATIVIDADE (FR-022).
 *
 * POR QUE AQUI, E NÃO NO MIDDLEWARE
 *
 * Renovar é reescrever o cookie, e Server Component não escreve cookie. O
 * middleware é o único lugar que alcança toda página, e foi a primeira
 * tentativa — mas ele roda no Edge Runtime, onde `node:crypto` não existe. A
 * sessão do portal é assinada com `createHmac`, então importar `session.ts` lá
 * quebra o build (e nem `tsc` nem `lint` avisam). Rota em runtime Node reusa a
 * MESMA assinatura, sem uma segunda implementação de HMAC que pudesse divergir
 * e deslogar todo mundo.
 *
 * A rota NÃO autentica ninguém: estende o que já é válido. Cookie ausente,
 * adulterado, parado há mais de 30 minutos ou com mais de 12h de login não é
 * renovado — `renewPatientSessionCookie` devolve `null` e a resposta é 401
 * genérico, como no resto do portal.
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  PATIENT_SESSION_COOKIE_NAME,
  PATIENT_SESSION_MAX_AGE_SECONDS,
  renewPatientSessionCookie,
} from '@/lib/core/patient-portal/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  const current = request.cookies.get(PATIENT_SESSION_COOKIE_NAME)?.value
  const renewed = renewPatientSessionCookie(current)

  if (!renewed) {
    return NextResponse.json(
      { error: { code: 'SESSION_INVALID', message: 'Sessão ausente ou expirada.' } },
      { status: 401 },
    )
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: PATIENT_SESSION_COOKIE_NAME,
    value: renewed,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PATIENT_SESSION_MAX_AGE_SECONDS,
  })
  return res
}
