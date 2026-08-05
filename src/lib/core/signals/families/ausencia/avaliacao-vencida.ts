/**
 * Feature 053 — última avaliação nutricional há N meses.
 *
 * `requiresPortalActivity: false`: a avaliação é feita PELA CLÍNICA, não pelo
 * paciente. Aplicar o filtro de portal aqui suprimiria a mensagem por um dado
 * que não depende do paciente — e o convite para reavaliar é justamente o que
 * traz de volta quem sumiu.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { EvaluationContext, SignalCandidate } from '../../types'
import { pacientesComUltimoRegistroAntigo } from './_ultimo-registro'

export async function evaluateAvaliacaoVencida(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { months: number }

  return pacientesComUltimoRegistroAntigo({
    supabase: ctx.supabase as SupabaseClient<Database>,
    tenantId: ctx.tenantId,
    patientIds: ctx.patientIds,
    cycleDate: ctx.cycleDate,
    tabela: 'nutrition_assessments',
    colunaData: 'assessed_at',
    limite: { meses: params.months },
  })
}
