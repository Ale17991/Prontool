/**
 * Feature 053 — sem consulta há N meses E sem retorno marcado.
 *
 * A única família do catálogo que serve clínica de qualquer especialidade, e a
 * mais próxima de receita.
 *
 * As duas condições são inseparáveis: mandar "faz 8 meses que você não vem"
 * para quem já tem consulta marcada para semana que vem é a mensagem que mais
 * rápido faz a clínica desligar a feature inteira. E é o erro mais fácil de
 * cometer, porque a primeira condição sozinha parece suficiente.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { EvaluationContext, SignalCandidate } from '../../types'
import { mesesEntre } from './_ultimo-registro'

export async function evaluateSemRetorno(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { months: number }
  if (ctx.patientIds.length === 0) return []

  const supabase = ctx.supabase as SupabaseClient<Database>
  const agora = `${ctx.cycleDate}T00:00:00.000Z`

  const { data, error } = await supabase
    .from('appointments')
    .select('patient_id, appointment_at')
    .eq('tenant_id', ctx.tenantId)
    .in('patient_id', ctx.patientIds)
    .order('appointment_at', { ascending: false })
  if (error) throw new Error(`sem_retorno: ${error.message}`)

  const ultimaPassada = new Map<string, string>()
  const temFutura = new Set<string>()

  for (const row of (data ?? []) as unknown as Array<{
    patient_id: string
    appointment_at: string
  }>) {
    if (row.appointment_at >= agora) {
      temFutura.add(row.patient_id)
      continue
    }
    // Ordenado do mais recente para o mais antigo: a primeira passada de cada
    // paciente é a última que ele teve.
    if (!ultimaPassada.has(row.patient_id)) {
      ultimaPassada.set(row.patient_id, row.appointment_at.slice(0, 10))
    }
  }

  const out: SignalCandidate[] = []

  for (const [patientId, ultima] of ultimaPassada) {
    // A segunda condição, e a que evita o constrangimento.
    if (temFutura.has(patientId)) continue

    const meses = mesesEntre(ultima, ctx.cycleDate)
    if (meses < params.months) continue

    out.push({
      patientId,
      observed: { ultimaConsulta: ultima, meses, limite: params.months },
      values: { meses: String(meses) },
    })
  }

  return out
}
