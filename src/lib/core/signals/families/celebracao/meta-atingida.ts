/**
 * Feature 053 — o paciente alcançou uma meta ativa.
 *
 * Dispara na VIRADA: a medição mais recente alcançou e a anterior não tinha
 * alcançado. Sem isso, quem bateu a meta e se mantém nela receberia parabéns
 * todo dia — o reconhecimento vira ruído justamente no melhor momento, e o
 * paciente aprende que a mensagem não significa nada.
 *
 * O texto não menciona número, e a família nem oferece placeholder para isso
 * (invariante 5 do contrato). "Seu peso caiu 4 kg" parece inofensivo, mas
 * estabelece que o número é o assunto — e torna a mensagem seguinte, quando ele
 * subir, muito pior.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { EvaluationContext, SignalCandidate } from '../../types'

interface Goal {
  patient_id: string
  metric_type: string
  direction: 'decrease' | 'increase'
  target_value: number
}

interface Measurement {
  patient_id: string
  value: number
  measured_at: string
}

export async function evaluateMetaAtingida(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { metricType: string }
  if (ctx.patientIds.length === 0) return []

  const supabase = ctx.supabase as SupabaseClient<Database>

  const { data: metasRaw, error } = await supabase
    .from('patient_metric_goals')
    .select('patient_id, metric_type, direction, target_value')
    .eq('tenant_id', ctx.tenantId)
    .eq('metric_type', params.metricType)
    .eq('active', true)
    .in('patient_id', ctx.patientIds)
  if (error) throw new Error(`meta_atingida: ${error.message}`)

  const metas = (metasRaw ?? []) as unknown as Goal[]
  if (metas.length === 0) return []

  const { data: medRaw, error: errMed } = await supabase
    .from('patient_measurements')
    .select('patient_id, value, measured_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('metric_type', params.metricType)
    .in('patient_id', metas.map((m) => m.patient_id))
    .order('measured_at', { ascending: false })
  if (errMed) throw new Error(`meta_atingida: ${errMed.message}`)

  // Duas mais recentes por paciente. A lista já vem ordenada do mais novo para
  // o mais antigo, então basta pegar as duas primeiras de cada.
  const porPaciente = new Map<string, Measurement[]>()
  for (const row of (medRaw ?? []) as unknown as Measurement[]) {
    const lista = porPaciente.get(row.patient_id) ?? []
    if (lista.length < 2) {
      lista.push(row)
      porPaciente.set(row.patient_id, lista)
    }
  }

  const out: SignalCandidate[] = []

  for (const meta of metas) {
    const medicoes = porPaciente.get(meta.patient_id) ?? []
    // Só uma medição não é virada: pode ser o primeiro registro de alguém que
    // já estava na meta antes de começar o acompanhamento, e parabenizar por
    // isso soa como a clínica se creditando de algo que não fez.
    if (medicoes.length < 2) continue

    const [atual, anterior] = medicoes as [Measurement, Measurement]
    const atingiuAgora = alcancou(atual.value, meta)
    const atingiuAntes = alcancou(anterior.value, meta)

    if (atingiuAgora && !atingiuAntes) {
      out.push({
        patientId: meta.patient_id,
        observed: {
          metricType: meta.metric_type,
          direction: meta.direction,
          alcancadoEm: atual.measured_at,
        },
        values: { metrica: rotulo(meta.metric_type) },
      })
    }
  }

  return out
}

function alcancou(valor: number, meta: Goal): boolean {
  return meta.direction === 'decrease' ? valor <= meta.target_value : valor >= meta.target_value
}

/** `peso_corporal` → `peso corporal`. O paciente não lê snake_case. */
function rotulo(metricType: string): string {
  return metricType.replace(/_/g, ' ')
}
