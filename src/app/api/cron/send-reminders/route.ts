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

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: NextRequest) {
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

  try {
    const supabase = createSupabaseServiceClient()
    const result = await processBatch(supabase, new Date())
    logger.info(result, 'cron-reminders-done')
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    logger.error(
      { errorCode: err instanceof Error ? err.name : 'unknown' },
      'cron-reminders-fatal',
    )
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
