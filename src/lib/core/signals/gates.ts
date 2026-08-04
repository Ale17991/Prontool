/**
 * Feature 053 — os portões entre "bateu a condição" e "a mensagem sai".
 *
 * Cada portão devolve um DESFECHO, nunca um booleano. A diferença não é
 * estilística: "não enviou" é inútil para a clínica, e a primeira pergunta que
 * ela faz é "por que meu paciente não recebeu?". Um booleano perde a resposta
 * no caminho; o desfecho é gravado na ocorrência e vira a explicação na tela.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { SignalOutcome } from './types'

const DIA_MS = 24 * 3600_000

/**
 * O filtro que impede a feature de cobrar quem simplesmente sumiu.
 *
 * `habit_checklist_marks` não distingue "não fez" de "não abriu o app" — linha
 * presente significa marcou, ausente pode ser qualquer um dos dois. Então, para
 * famílias que observam registro DO PACIENTE, a ausência só é sinal quando ele
 * esteve lá e não registrou.
 *
 * Dois níveis, e ambos importam:
 *
 *   ELEGÍVEL — tem ao menos um acesso na história inteira. Quem nunca entrou não
 *   é usuário do portal: não tem como registrar, e a regra não se aplica a ele.
 *   Não é "sumido", é outro público.
 *
 *   ATIVO NA JANELA — entrou dentro do período avaliado. Sem isso, a ausência de
 *   registro não informa nada sobre o que ele fez.
 *
 * Quem cai fora é atendido pela família de reengajamento, que tem prioridade
 * mais alta justamente para ele não ficar sem contato nenhum.
 */
export async function portalActivity(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientIds: string[],
  windowDays: number,
  now: Date,
): Promise<{ elegiveis: Set<string>; ativosNaJanela: Set<string> }> {
  const elegiveis = new Set<string>()
  const ativosNaJanela = new Set<string>()
  if (patientIds.length === 0) return { elegiveis, ativosNaJanela }

  const corte = new Date(now.getTime() - windowDays * DIA_MS).toISOString()

  const { data, error } = await supabase
    .from('patient_portal_access_log')
    .select('patient_id, created_at')
    .eq('tenant_id', tenantId)
    .in('patient_id', patientIds)
  if (error) throw new Error(`portalActivity failed: ${error.message}`)

  for (const row of data ?? []) {
    const r = row as { patient_id: string; created_at: string }
    elegiveis.add(r.patient_id)
    if (r.created_at >= corte) ativosNaJanela.add(r.patient_id)
  }
  return { elegiveis, ativosNaJanela }
}

export interface GateContext {
  /** Pacientes ainda em silêncio para esta regra. */
  emSilencio: Set<string>
  /** Quantas mensagens cada paciente já recebeu na semana, todas as regras. */
  enviadasNaSemana: Map<string, number>
  /** Teto semanal da clínica. */
  cap: number
  /** Só para famílias com `requiresPortalActivity`. */
  portal: { elegiveis: Set<string>; ativosNaJanela: Set<string> } | null
  /** Quantas mensagens já foram decididas para cada paciente NESTE ciclo. */
  decididasNesteCiclo: Map<string, number>
}

/**
 * Decide o desfecho de um candidato. `null` significa "pode enviar".
 *
 * A ordem é do mais estrutural ao mais circunstancial: portal antes de
 * silêncio, silêncio antes de teto. Um paciente suprimido por falta de
 * atividade no portal não deveria consumir vaga do teto nem "gastar" a janela
 * de silêncio — ele nunca esteve elegível a receber esta mensagem.
 */
export function decideGate(patientId: string, ctx: GateContext): SignalOutcome | null {
  if (ctx.portal) {
    if (!ctx.portal.elegiveis.has(patientId)) return 'suprimida_sem_portal'
    if (!ctx.portal.ativosNaJanela.has(patientId)) return 'suprimida_sem_portal'
  }

  if (ctx.emSilencio.has(patientId)) return 'silenciada'

  const jaRecebeu =
    (ctx.enviadasNaSemana.get(patientId) ?? 0) + (ctx.decididasNesteCiclo.get(patientId) ?? 0)
  if (jaRecebeu >= ctx.cap) return 'adiada'

  return null
}
