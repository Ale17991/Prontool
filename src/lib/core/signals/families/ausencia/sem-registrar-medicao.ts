/**
 * Feature 053 — a métrica escolhida está sem registro novo há N dias.
 *
 * `requiresPortalActivity: true`: é registro que o paciente faz. Sem o filtro,
 * a regra cobraria quem se pesou e não abriu o app para anotar.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { EvaluationContext, SignalCandidate } from '../../types'
import { pacientesComUltimoRegistroAntigo, rotuloMetrica } from './_ultimo-registro'

export async function evaluateSemRegistrarMedicao(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { metricType: string; days: number }

  return pacientesComUltimoRegistroAntigo({
    supabase: ctx.supabase as SupabaseClient<Database>,
    tenantId: ctx.tenantId,
    patientIds: ctx.patientIds,
    cycleDate: ctx.cycleDate,
    tabela: 'patient_measurements',
    colunaData: 'measured_at',
    filtro: { coluna: 'metric_type', valor: params.metricType },
    limite: { dias: params.days },
    valoresExtras: { metrica: rotuloMetrica(params.metricType) },
  })
}
