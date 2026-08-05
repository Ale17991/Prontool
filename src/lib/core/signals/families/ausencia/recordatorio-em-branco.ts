/**
 * Feature 053 — sem recordatório alimentar há N dias.
 *
 * `requiresPortalActivity: true`: o recordatório é preenchido pelo paciente.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { EvaluationContext, SignalCandidate } from '../../types'
import { pacientesComUltimoRegistroAntigo } from './_ultimo-registro'

export async function evaluateRecordatorioEmBranco(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { days: number }

  return pacientesComUltimoRegistroAntigo({
    supabase: ctx.supabase as SupabaseClient<Database>,
    tenantId: ctx.tenantId,
    patientIds: ctx.patientIds,
    cycleDate: ctx.cycleDate,
    tabela: 'food_recalls',
    colunaData: 'recall_date',
    limite: { dias: params.days },
  })
}
