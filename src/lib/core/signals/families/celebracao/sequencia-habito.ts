/**
 * Feature 053 — o paciente manteve uma sequência de dias marcando um hábito.
 *
 * O oposto exato de `habito_sem_registro`, e por isso muito mais simples: aqui
 * o dado está PRESENTE. Não há ambiguidade a resolver, não há filtro de portal
 * a aplicar, não há linguagem a policiar — quem marcou sete dias marcou sete
 * dias, e não existe jeito de acusar alguém injustamente por isso.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { addDays, toDayNumber } from '@/lib/core/habits/period'
import type { EvaluationContext, SignalCandidate } from '../../types'

interface ChecklistRow {
  id: string
  patient_id: string
  start_date: string
  items: { id: string; label: string }[] | null
}

export async function evaluateSequenciaHabito(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { itemId?: string; days: number }
  const alvo = params.days
  if (ctx.patientIds.length === 0) return []

  const supabase = ctx.supabase as SupabaseClient<Database>

  const { data: gradesRaw, error } = await supabase
    .from('patient_habit_checklists')
    .select('id, patient_id, start_date, items')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true)
    .in('patient_id', ctx.patientIds)
  if (error) throw new Error(`sequencia_habito: ${error.message}`)

  const grades = (gradesRaw ?? []) as unknown as ChecklistRow[]
  if (grades.length === 0) return []

  const desde = addDays(ctx.cycleDate, -(alvo + 2))
  const { data: marcasRaw, error: errMarcas } = await supabase
    .from('habit_checklist_marks')
    .select('checklist_id, item_id, mark_date')
    .eq('tenant_id', ctx.tenantId)
    .in('checklist_id', grades.map((g) => g.id))
    .gte('mark_date', desde)
  if (errMarcas) throw new Error(`sequencia_habito: ${errMarcas.message}`)

  const marcadas = new Set(
    (marcasRaw ?? []).map((m) => {
      const r = m as { checklist_id: string; item_id: string; mark_date: string }
      return `${r.checklist_id}|${r.item_id}|${r.mark_date}`
    }),
  )

  const out: SignalCandidate[] = []

  for (const grade of grades) {
    const itens = (grade.items ?? []).filter((i) => !params.itemId || i.id === params.itemId)
    const conquistados: { label: string; dias: number }[] = []

    for (const item of itens) {
      const seq = sequenciaAtual({
        marcadas,
        checklistId: grade.id,
        itemId: item.id,
        hoje: ctx.cycleDate,
        piso: grade.start_date,
        maximo: alvo,
      })
      if (seq >= alvo) conquistados.push({ label: item.label, dias: seq })
    }

    if (conquistados.length === 0) continue

    out.push({
      patientId: grade.patient_id,
      observed: {
        checklistId: grade.id,
        itens: conquistados,
        alvoDias: alvo,
      },
      values: {
        habito: listar(conquistados.map((c) => c.label)),
        dias: String(alvo),
      },
    })
  }

  return out
}

/**
 * Sequência que continua até hoje. Se hoje ainda não foi marcado, começa de
 * ontem — o dia não acabou, e zerar a sequência toda manhã puniria a pessoa por
 * acordar. É a mesma regra do `currentStreak` de `habits/period.ts`, aplicada
 * aqui sobre um recorte que não precisa materializar o período inteiro.
 */
function sequenciaAtual(args: {
  marcadas: Set<string>
  checklistId: string
  itemId: string
  hoje: string
  piso: string
  maximo: number
}): number {
  const { marcadas, checklistId, itemId, hoje, piso, maximo } = args
  const pisoN = toDayNumber(piso)
  const chave = (d: string) => `${checklistId}|${itemId}|${d}`

  let dia = marcadas.has(chave(hoje)) ? hoje : addDays(hoje, -1)
  let count = 0

  while (count < maximo && toDayNumber(dia) >= pisoN && marcadas.has(chave(dia))) {
    count += 1
    dia = addDays(dia, -1)
  }
  return count
}

function listar(labels: string[]): string {
  if (labels.length === 1) return labels[0] as string
  const ultimo = labels[labels.length - 1] as string
  return `${labels.slice(0, -1).join(', ')} e ${ultimo}`
}
