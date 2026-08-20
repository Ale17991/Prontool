/**
 * Feature 018 — POST /api/cron/send-reminders
 *
 * Endpoint do Vercel Cron (a cada 15min). Autenticado via
 * `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Resposta JSON com contadores agregados do ciclo. Falhas individuais
 * NÃO derrubam o ciclo (FR-014, Princípio II audit registra cada uma).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { logger } from '@/lib/observability/logger'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { processBatch } from '@/lib/core/reminders/process-batch'
import { evaluateAutomations } from '@/lib/core/automations/evaluate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * O Vercel Cron invoca com **GET**, não com POST — e a rota só exportava POST,
 * então todo disparo desde que o cron existe recebeu 405 e o ciclo NUNCA rodou
 * sozinho em produção (descoberto em 11/08/2026 pelo log
 * `GET /api/cron/send-reminders 405`). O sintoma era mudo: sem execução, sem
 * erro visível, sem alerta — só `reminder_last_run_at` nulo em todas as
 * clínicas, que é fácil confundir com "ninguém tinha lembrete para enviar".
 *
 * POST fica exportado junto porque é o que permite disparar o ciclo à mão.
 */
export async function GET(request: NextRequest) {
  return executarCiclo(request)
}

export async function POST(request: NextRequest) {
  return executarCiclo(request)
}

async function executarCiclo(request: NextRequest) {
  // Registrado ANTES da autenticação de propósito. O `cron-reminders-start`
  // abaixo só é escrito depois do guard, então uma invocação recusada por
  // credencial não deixava rastro nenhum na aplicação — e "a Vercel não chamou"
  // ficava indistinguível de "chamou e levou 401". São causas opostas: uma se
  // conserta no registro do cron, a outra reescrevendo a variável.
  logger.info(
    {
      metodo: request.method,
      temSecret: Boolean(process.env.CRON_SECRET),
      temHeader: request.headers.has('authorization'),
    },
    'cron-reminders-invocado',
  )

  const secret = process.env.CRON_SECRET
  if (!secret || secret === 'PLACEHOLDER_dev_secret') {
    // Em dev sem secret real: bypass para permitir teste local (mas log de aviso)
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }
    logger.warn({}, 'cron-reminders-running-without-secret-dev-only')
  } else {
    const header = request.headers.get('authorization')
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }
  }

  logger.info({}, 'cron-reminders-start')

  const supabase = createSupabaseServiceClient()
  const agora = new Date()

  // Os DOIS motores rodam neste ciclo, e a separação em try/catch próprios não
  // é zelo excessivo: são features distintas, e falha na avaliação de
  // automações (056) não pode impedir o lembrete de consulta (018/051) de sair,
  // nem o contrário. O ciclo devolve o que conseguiu fazer.
  let result
  try {
    result = await processBatch(supabase, agora)
    logger.info(result, 'cron-reminders-done')
  } catch (err) {
    logger.error({ errorCode: err instanceof Error ? err.name : 'unknown' }, 'cron-reminders-fatal')
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }

  let automacoes = null
  try {
    automacoes = await evaluateAutomations(supabase, agora)
    logger.info(automacoes, 'cron-automacoes-done')
  } catch (err) {
    logger.error(
      { errorCode: err instanceof Error ? err.name : 'unknown' },
      'cron-automacoes-fatal',
    )
  }

  return NextResponse.json({ ...result, automacoes }, { status: 200 })
}
