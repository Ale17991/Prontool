/**
 * Feature 053 — meses de acompanhamento desde a primeira consulta.
 *
 * Dispara no dia exato do "mesversário" e só quando o número de meses é
 * múltiplo do parâmetro: com `months: 6`, fala aos 6, 12, 18. Sem a checagem de
 * múltiplo, a regra dispararia todo mês e a marca perderia o sentido de marco.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { EvaluationContext, SignalCandidate } from '../../types'

export async function evaluateAniversarioAcompanhamento(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { months: number }
  if (ctx.patientIds.length === 0) return []

  const supabase = ctx.supabase as SupabaseClient<Database>

  const { data, error } = await supabase
    .from('appointments')
    .select('patient_id, appointment_at')
    .eq('tenant_id', ctx.tenantId)
    .in('patient_id', ctx.patientIds)
    .lte('appointment_at', new Date().toISOString())
    .order('appointment_at', { ascending: true })
  if (error) throw new Error(`aniversario_acompanhamento: ${error.message}`)

  // Primeira consulta de cada paciente: a lista vem da mais antiga para a mais
  // nova, então a primeira linha de cada um é a que interessa.
  const primeira = new Map<string, string>()
  for (const row of data ?? []) {
    const r = row as { patient_id: string; appointment_at: string }
    if (!primeira.has(r.patient_id)) primeira.set(r.patient_id, r.appointment_at.slice(0, 10))
  }

  const out: SignalCandidate[] = []
  const [ano, mes, dia] = ctx.cycleDate.split('-').map(Number) as [number, number, number]

  for (const [patientId, inicio] of primeira) {
    const [a0, m0, d0] = inicio.split('-').map(Number) as [number, number, number]

    // Só no dia do mês em que começou. Paciente que começou dia 31 e o mês só
    // tem 30 é tratado no último dia — senão ele nunca teria mesversário.
    const ultimoDiaDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
    const diaAlvo = Math.min(d0, ultimoDiaDoMes)
    if (dia !== diaAlvo) continue

    const meses = (ano - a0) * 12 + (mes - m0)
    if (meses <= 0) continue
    if (meses % params.months !== 0) continue

    out.push({
      patientId,
      observed: { primeiraConsulta: inicio, meses },
      values: { meses: String(meses) },
    })
  }

  return out
}
