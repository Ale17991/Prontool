/**
 * Feature 053 — plano alimentar prescrito há N meses, sem revisão.
 *
 * `diet_plan_prescriptions` é append-only por natureza: cada revisão gera uma
 * prescrição nova. Então "a mais recente é antiga" já significa "não foi
 * revisado" — não é preciso comparar com nada.
 *
 * `requiresPortalActivity: false`: prescrever é ato da clínica.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { EvaluationContext, SignalCandidate } from '../../types'
import { pacientesComUltimoRegistroAntigo } from './_ultimo-registro'

export async function evaluatePlanoSemRevisao(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { months: number }

  return pacientesComUltimoRegistroAntigo({
    supabase: ctx.supabase as SupabaseClient<Database>,
    tenantId: ctx.tenantId,
    patientIds: ctx.patientIds,
    cycleDate: ctx.cycleDate,
    tabela: 'diet_plan_prescriptions',
    colunaData: 'prescribed_at',
    limite: { meses: params.months },
  })
}
