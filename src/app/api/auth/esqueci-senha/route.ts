/**
 * POST /api/auth/esqueci-senha — pedido público de redefinição de senha.
 *
 * Rota PÚBLICA (exceção registrada em `scripts/check-require-role.mjs`): quem
 * a chama está justamente sem conseguir entrar, então exigir sessão seria
 * exigir o que ela veio recuperar. A defesa não é papel — é rate-limit por
 * caixa e por origem, dentro de `requestPasswordReset`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { requestPasswordReset } from '@/lib/core/auth/password-reset'
import { originFromHeaders } from '@/lib/core/app-url'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BodySchema = z.object({
  email: z.string().trim().email().max(254),
})

/**
 * A MESMA resposta para: e-mail enviado, e-mail que não existe, e envio que
 * falhou. Responder "não encontramos esse e-mail" transformaria a tela num
 * verificador de contas — dá para descobrir quem trabalha numa clínica sem
 * jamais entrar no sistema. O preço é conhecido e aceito: quem digitou o
 * endereço errado espera um e-mail que não vem. Por isso o texto fala em
 * "se houver uma conta", em vez de afirmar que foi enviado.
 */
const GENERIC_OK = {
  ok: true,
  message:
    'Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha. Verifique também a caixa de spam.',
}

function extractIp(request: NextRequest): string {
  // Mesma regra do login do portal (030): nunca o x-forwarded-for mais à
  // esquerda, que o cliente controla — seria trocar de balde de rate-limit a
  // cada request, e o teto por origem deixaria de existir.
  if (request.ip) return request.ip
  const vercel = request.headers.get('x-vercel-forwarded-for')
  if (vercel) return vercel.split(',')[0]!.trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(GENERIC_OK)
  }

  const parsed = BodySchema.safeParse(body)
  // Nem o formato inválido vira erro visível: se "abc" respondesse diferente
  // de um e-mail bem formado, a resposta voltaria a carregar informação.
  if (!parsed.success) return NextResponse.json(GENERIC_OK)

  const outcome = await requestPasswordReset({
    supabaseService: createSupabaseServiceClient(),
    email: parsed.data.email,
    ip: extractIp(request),
    baseUrl: originFromHeaders(request.headers),
  })

  // O 429 é a ÚNICA saída que difere, e de propósito: sem ele a tela não tem
  // como dizer "espere um pouco" e a pessoa fica clicando num botão que já
  // não faz nada. Ele não vaza existência de conta — o limite conta tentativas,
  // não acertos, então estoura igual para endereço que existe e que não existe.
  if (outcome.status === 'rate_limited') {
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Muitos pedidos em pouco tempo. Tente novamente mais tarde.',
        },
      },
      { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSec) } },
    )
  }

  return NextResponse.json(GENERIC_OK)
}
