/**
 * Feature 053 — POST /api/cron/patient-signals
 *
 * Ciclo diário das notificações por comportamento. Separado do ciclo de
 * lembretes de propósito: aquele tem janela de 15 minutos amarrada a horário de
 * consulta, este raciocina em dias. Juntos, um estouraria o `maxDuration` do
 * outro.
 *
 * O ciclo AVALIA e ENFILEIRA; a entrega acontece em
 * `/api/workers/send-patient-message`, chamado pelo QStash com atraso crescente
 * por clínica. É o mesmo padrão da 051, e existe porque cron mais frequente que
 * diário trava TODOS os deploys no plano Hobby.
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { evaluateCycle } from '@/lib/core/signals/evaluate-cycle'
import { dispatchPending } from '@/lib/core/signals/dispatch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret === 'PLACEHOLDER_dev_secret') {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }
    logger.warn({}, 'cron-signals-running-without-secret-dev-only')
  } else {
    const header = request.headers.get('authorization')
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }
  }

  logger.info({}, 'cron-signals-start')

  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
    const { result, pending } = await evaluateCycle(supabase, new Date())
    const despacho = await dispatchPending(supabase, pending)

    // Contadores POR DESFECHO, não só o total. "312 avaliadas, 18 enviadas"
    // sem a decomposição não diz se o motor está funcionando ou barrando tudo —
    // e é essa distinção que a clínica precisa quando reclama.
    const payload = { ok: true, ...result, despacho }
    logger.info(payload, 'cron-signals-done')
    return NextResponse.json(payload, { status: 200 })
  } catch (err) {
    logger.error(
      { errorCode: err instanceof Error ? err.name : 'unknown' },
      'cron-signals-fatal',
    )
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
