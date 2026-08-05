/**
 * Feature 053 — N medições consecutivas andando na direção contrária à meta.
 *
 * ---
 *
 * O TEXTO DESTA FAMÍLIA NÃO MENCIONA NÚMERO, e a família nem oferece
 * placeholder para isso (invariante 5 do contrato, coberta por teste).
 *
 * Mandar "seu peso subiu 2 kg" por WhatsApp é devolver ao paciente um dado
 * clínico sem ninguém junto para interpretá-lo, e para um público que
 * frequentemente tem relação difícil com esse número. A regra existe para
 * TRAZER O PACIENTE À CONSULTA, não para dar o veredito por mensagem — e a
 * restrição mora no contrato justamente para não depender da boa vontade de
 * quem escreve o texto.
 *
 * ---
 *
 * `requiresPortalActivity: false`: a medição pode ter sido lançada pela
 * clínica, então ausência de acesso ao portal não diz nada sobre este sinal.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { EvaluationContext, SignalCandidate } from '../../types'
import { rotuloMetrica } from './_ultimo-registro'

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

export async function evaluateAfastandoDaMeta(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { metricType: string; consecutive: number }
  if (ctx.patientIds.length === 0) return []

  const supabase = ctx.supabase as SupabaseClient<Database>

  const { data: metasRaw, error } = await supabase
    .from('patient_metric_goals')
    .select('patient_id, metric_type, direction, target_value')
    .eq('tenant_id', ctx.tenantId)
    .eq('metric_type', params.metricType)
    .eq('active', true)
    .in('patient_id', ctx.patientIds)
  if (error) throw new Error(`afastando_da_meta: ${error.message}`)

  const metas = (metasRaw ?? []) as unknown as Goal[]
  if (metas.length === 0) return []

  const { data: medRaw, error: errMed } = await supabase
    .from('patient_measurements')
    .select('patient_id, value, measured_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('metric_type', params.metricType)
    .in('patient_id', metas.map((m) => m.patient_id))
    .order('measured_at', { ascending: false })
  if (errMed) throw new Error(`afastando_da_meta: ${errMed.message}`)

  // Precisa de `consecutive` transições, logo de `consecutive + 1` medições.
  const necessarias = params.consecutive + 1
  const porPaciente = new Map<string, Measurement[]>()
  for (const row of (medRaw ?? []) as unknown as Measurement[]) {
    const lista = porPaciente.get(row.patient_id) ?? []
    if (lista.length < necessarias) {
      lista.push(row)
      porPaciente.set(row.patient_id, lista)
    }
  }

  const out: SignalCandidate[] = []

  for (const meta of metas) {
    const medicoes = porPaciente.get(meta.patient_id) ?? []
    if (medicoes.length < necessarias) continue

    // Já está na meta? Então não está se afastando dela, mesmo que tenha
    // oscilado — cobrar quem já chegou é o oposto do que a regra quer.
    const atual = medicoes[0] as Measurement
    if (alcancou(atual.value, meta)) continue

    // `medicoes` vem do mais novo para o mais antigo; cada par consecutivo é
    // uma transição do antigo para o novo.
    let afastou = true
    for (let i = 0; i < params.consecutive; i++) {
      const novo = medicoes[i] as Measurement
      const velho = medicoes[i + 1] as Measurement
      if (!piorou(velho.value, novo.value, meta)) {
        afastou = false
        break
      }
    }
    if (!afastou) continue

    out.push({
      patientId: meta.patient_id,
      observed: {
        metricType: meta.metric_type,
        direction: meta.direction,
        medicoesConsecutivas: params.consecutive,
        ultimaEm: atual.measured_at,
      },
      values: { metrica: rotuloMetrica(meta.metric_type) },
    })
  }

  return out
}

function alcancou(valor: number, meta: Goal): boolean {
  return meta.direction === 'decrease' ? valor <= meta.target_value : valor >= meta.target_value
}

/** Andou na direção contrária à meta entre uma medição e a seguinte. */
function piorou(anterior: number, atual: number, meta: Goal): boolean {
  return meta.direction === 'decrease' ? atual > anterior : atual < anterior
}
