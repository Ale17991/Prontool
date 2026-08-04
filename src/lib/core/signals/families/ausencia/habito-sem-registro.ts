/**
 * Feature 053 — hábito sem registro por N dias seguidos.
 *
 * A família que motivou a feature, e a que mais exige cuidado: o que ela
 * observa é a AUSÊNCIA de uma linha em `habit_checklist_marks`, e ausência ali
 * não distingue "não fiz" de "não abri o app". Por isso ela declara
 * `requiresPortalActivity: true` — quem não esteve no portal na janela é
 * suprimido antes de qualquer mensagem sair.
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

export async function evaluateHabitoSemRegistro(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { itemId?: string; days: number }
  const dias = params.days
  if (ctx.patientIds.length === 0) return []

  const supabase = ctx.supabase as SupabaseClient<Database>

  const { data: gradesRaw, error } = await supabase
    .from('patient_habit_checklists')
    .select('id, patient_id, start_date, items')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true)
    .in('patient_id', ctx.patientIds)
  if (error) throw new Error(`habito_sem_registro: ${error.message}`)

  const grades = (gradesRaw ?? []) as unknown as ChecklistRow[]
  if (grades.length === 0) return []

  // Ontem, e não hoje: o dia em curso ainda não acabou, e cobrar alguém às 9h
  // por não ter marcado o hábito de hoje é cobrar cedo demais.
  const ontem = addDays(ctx.cycleDate, -1)
  // Busca uma folga além da janela — a contagem para trás pode atravessar o
  // limite exato quando a ausência é mais longa que o parâmetro.
  const desde = addDays(ctx.cycleDate, -(dias + 2))

  const { data: marcasRaw, error: errMarcas } = await supabase
    .from('habit_checklist_marks')
    .select('checklist_id, item_id, mark_date')
    .eq('tenant_id', ctx.tenantId)
    .in('checklist_id', grades.map((g) => g.id))
    .gte('mark_date', desde)
  if (errMarcas) throw new Error(`habito_sem_registro: ${errMarcas.message}`)

  const marcadas = new Set(
    (marcasRaw ?? []).map((m) => {
      const r = m as { checklist_id: string; item_id: string; mark_date: string }
      return `${r.checklist_id}|${r.item_id}|${r.mark_date}`
    }),
  )

  const out: SignalCandidate[] = []

  for (const grade of grades) {
    const itens = (grade.items ?? []).filter(
      (i) => !params.itemId || i.id === params.itemId,
    )
    if (itens.length === 0) continue

    const abandonados: { id: string; label: string; dias: number }[] = []

    for (const item of itens) {
      const semRegistro = contarDiasSemRegistro({
        marcadas,
        checklistId: grade.id,
        itemId: item.id,
        ultimoDia: ontem,
        // Piso da janela: a grade não pode ser cobrada por dias em que não
        // existia. Cobrar alguém por não ter feito o que ainda não lhe foi
        // pedido destrói a confiança na automação inteira, não só na regra.
        piso: grade.start_date,
        maximo: dias,
      })
      if (semRegistro >= dias) {
        abandonados.push({ id: item.id, label: item.label, dias: semRegistro })
      }
    }

    if (abandonados.length === 0) continue

    // Um paciente com dois hábitos abandonados recebe UMA mensagem, não duas
    // (FR-013). Duas cobranças no mesmo dia sobre a mesma pessoa somam para
    // desânimo, não para adesão.
    out.push({
      patientId: grade.patient_id,
      observed: {
        checklistId: grade.id,
        itens: abandonados.map((a) => ({ id: a.id, label: a.label, dias: a.dias })),
        janelaDias: dias,
        ultimoDiaAvaliado: ontem,
      },
      values: {
        habito: listar(abandonados.map((a) => a.label)),
        dias: String(Math.min(...abandonados.map((a) => a.dias))),
      },
    })
  }

  return out
}

/**
 * Conta dias consecutivos sem marcação, andando para trás a partir de
 * `ultimoDia`. Para no `piso` (início da grade) e no `maximo` — não interessa
 * se são 40 ou 400 dias, interessa se cruzou o limite.
 */
function contarDiasSemRegistro(args: {
  marcadas: Set<string>
  checklistId: string
  itemId: string
  ultimoDia: string
  piso: string
  maximo: number
}): number {
  const { marcadas, checklistId, itemId, ultimoDia, piso, maximo } = args
  const pisoN = toDayNumber(piso)
  let count = 0
  let dia = ultimoDia

  while (count < maximo && toDayNumber(dia) >= pisoN) {
    if (marcadas.has(`${checklistId}|${itemId}|${dia}`)) break
    count += 1
    dia = addDays(dia, -1)
  }
  return count
}

/** "água", "água e sono", "água, sono e caminhada". */
function listar(labels: string[]): string {
  if (labels.length === 1) return labels[0] as string
  const ultimo = labels[labels.length - 1] as string
  return `${labels.slice(0, -1).join(', ')} e ${ultimo}`
}
