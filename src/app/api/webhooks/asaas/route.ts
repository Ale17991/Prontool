import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { handleAsaasWebhook, type AsaasWebhookBody } from '@/lib/core/billing/webhook'

/**
 * Webhook de cobrança do Asaas — é por aqui que o pagamento da assinatura vira
 * acesso liberado.
 *
 * Rota pública por natureza (quem chama é o Asaas, de fora), autenticada pelo
 * token compartilhado que configuramos no painel deles e que vem no header
 * `asaas-access-token`. O prefixo `webhooks/` já é isento de `requireRole` em
 * `check-require-role.mjs` — a autenticação aqui é o token, não a sessão.
 *
 * O Asaas usa FILA SEQUENCIAL: se respondermos != 200, ele para de entregar
 * TODOS os eventos daquela fila até o problema ser resolvido no painel. Por
 * isso 200 é a resposta certa para payload que não reconhecemos ou cuja clínica
 * não identificamos — insistir não melhora nenhum dos dois, e travaria a fila
 * inteira por causa de um evento órfão. Falha REAL (banco fora) devolve 500 de
 * propósito: aí a reentrega é exatamente o que queremos.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Comparação em tempo constante. `===` vaza o prefixo acertado pelo tempo. */
function tokensBatem(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN
  if (!expected) {
    // Sem token configurado a rota fica FECHADA. Aceitar qualquer chamada
    // porque a variável não foi definida daria a qualquer um na internet o
    // poder de marcar assinatura como paga.
    logger.error({ route: '/api/webhooks/asaas' }, 'asaas-webhook-token-missing')
    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 })
  }

  const received = req.headers.get('asaas-access-token') ?? ''
  if (!received || !tokensBatem(received, expected)) {
    logger.warn({ route: '/api/webhooks/asaas' }, 'asaas-webhook-bad-token')
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  let body: AsaasWebhookBody
  try {
    body = (await req.json()) as AsaasWebhookBody
  } catch {
    return NextResponse.json({ ok: true, ignored: 'invalid-json' })
  }

  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient<Database>

  try {
    const outcome = await handleAsaasWebhook(supabase, body)
    return NextResponse.json({ ok: true, ...outcome })
  } catch (err) {
    // Falha nossa: 500 para o Asaas reentregar. O evento já está gravado com o
    // erro, então a reentrega reprocessa em vez de recomeçar do zero.
    logger.error(
      {
        route: '/api/webhooks/asaas',
        event: body.event ?? null,
        err: err instanceof Error ? err.message : String(err),
      },
      'asaas-webhook-failed',
    )
    return NextResponse.json({ error: 'PROCESSING_FAILED' }, { status: 500 })
  }
}
