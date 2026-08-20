/**
 * Feature 056 — fontes baseadas no checklist de hábitos (0189).
 *
 * Duas fontes, e elas NÃO são simétricas — a assimetria é o ponto mais
 * importante deste arquivo.
 *
 * O checklist marca só o POSITIVO: linha presente significa "marquei"; linha
 * ausente é ambígua de propósito, porque não distingue "não fiz" de "não abri o
 * app". Foi decisão consciente da 0189.
 *
 * A consequência:
 *   - `checklist_marcado` se apoia em EVIDÊNCIA. "Álcool marcado 3 vezes nesta
 *     semana" é fato, e a mensagem pode afirmar.
 *   - `checklist_sem_marcacao` se apoia em INFERÊNCIA. O sistema sabe "não
 *     marcou", nunca "não cumpriu" — e por isso ela declara um `warning`, que a
 *     tela é obrigada a mostrar (FR-009). Sem esse aviso, a clínica escreve
 *     "você não bebeu água ontem" e o produto mente para o paciente que bebeu e
 *     esqueceu de marcar.
 */

import { z } from 'zod'
import { registerSource } from './registry'
import { currentPeriod, type PeriodKind } from '@/lib/core/habits/period'
import { pageAll } from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

interface ChecklistRow {
  id: string
  patient_id: string
  period_kind: string
  start_date: string
  items: Array<{ id: string; label: string }> | null
}

/**
 * Os checklists ativos da clínica que contêm o item procurado, já com o
 * paciente apto a receber. Filtrar consentimento aqui — e não depois — é o que
 * impede varrer a base inteira todo dia.
 */
async function checklistsComItem(
  ctx: EnumerateContext,
  itemId: string,
): Promise<Array<ChecklistRow & { label: string }>> {
  const linhas = await pageAll<
    ChecklistRow & {
      patients: {
        status: string | null
        automations_opt_in: boolean | null
        anonymized_at: string | null
        phone_enc: unknown
      }
    }
  >(
    (from, to) =>
      ctx.supabase
        .from('patient_habit_checklists')
        .select(
          'id, patient_id, period_kind, start_date, items, patients!inner(status, automations_opt_in, anonymized_at, phone_enc)',
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('active', true)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{
        data: unknown
        error: { message: string } | null
      }>,
    'checklistsComItem',
  )

  const out: Array<ChecklistRow & { label: string }> = []
  for (const r of linhas) {
    const p = r.patients
    if (!p || p.anonymized_at || p.status !== 'ativo') continue
    if (p.automations_opt_in !== true) continue
    if (!p.phone_enc) continue

    // O item vive no JSONB porque a grade é ajustável POR PACIENTE. Item
    // removido da grade de alguém simplesmente não aparece aqui — e é assim
    // que gatilhos deixam de valer para quem não tem mais aquele hábito.
    const item = (r.items ?? []).find((i) => i.id === itemId)
    if (!item) continue

    out.push({ ...r, label: item.label })
  }
  return out
}

async function marcasNoIntervalo(
  ctx: EnumerateContext,
  checklistId: string,
  itemId: string,
  de: string,
  ate: string,
): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from('habit_checklist_marks')
    .select('mark_date')
    .eq('tenant_id', ctx.tenantId)
    .eq('checklist_id', checklistId)
    .eq('item_id', itemId)
    .gte('mark_date', de)
    .lte('mark_date', ate)
  if (error) throw new Error(`marcasNoIntervalo falhou: ${error.message}`)
  return ((data ?? []) as Array<{ mark_date: string }>).map((m) => m.mark_date)
}

// ---------------------------------------------------------------------------
// Marcado N vezes no período
// ---------------------------------------------------------------------------

registerSource({
  id: 'checklist_marcado',
  label: 'Hábito marcado N vezes no período',
  group: 'checklist',
  requiresModule: 'habitos',
  hint: 'Dispara quando o paciente marca o hábito pelo menos N vezes no período corrente do checklist.',
  paramsSchema: z
    .object({
      itemId: z.string().min(1).max(60),
      vezes: z.number().int().min(1).max(31),
    })
    .strict(),
  fields: [
    {
      name: 'itemId',
      label: 'Qual hábito',
      kind: 'select',
      optionsFrom: 'habit_items',
      hint: 'A lista traz os hábitos que existem nos checklists desta clínica.',
    },
    {
      name: 'vezes',
      label: 'Quantas marcações no período',
      kind: 'number',
      min: 1,
      max: 31,
      defaultValue: 3,
    },
  ],
  variables: ['habito', 'vezes'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { itemId, vezes } = ctx.params as { itemId: string; vezes: number }
    const out: SourceCandidate[] = []

    for (const c of await checklistsComItem(ctx, itemId)) {
      // Período CALCULADO, nunca materializado — mesma regra da 0189. Mensal
      // segue calendário, não 30 dias.
      const periodo = currentPeriod(c.start_date, c.period_kind as PeriodKind, ctx.today)
      const marcas = await marcasNoIntervalo(ctx, c.id, itemId, periodo.startDate, periodo.endDate)
      if (marcas.length < vezes) continue

      out.push({
        patientId: c.patient_id,
        // Uma vez por período: marcar a quarta e a quinta vez não remanda.
        occurrenceKey: `${c.id}:P${periodo.index}`,
        variables: { habito: c.label, vezes: String(marcas.length) },
      })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Sem marcação há N dias
// ---------------------------------------------------------------------------

registerSource({
  id: 'checklist_sem_marcacao',
  label: 'Hábito sem marcação há N dias',
  group: 'checklist',
  requiresModule: 'habitos',
  hint: 'Dispara quando o hábito fica N dias seguidos sem nenhuma marcação, dentro do período corrente.',
  /**
   * FR-009 — obrigação desta fonte, não da tela. O dado disponível é "não
   * marcou". Escrever "você não cumpriu" seria afirmar o que o checklist não
   * registra, e erra justamente com quem cumpriu e esqueceu de marcar.
   */
  warning:
    'O checklist registra apenas o que o paciente MARCOU. Este gatilho sabe que a marcação não veio — não que o hábito deixou de ser cumprido. Escreva a mensagem como um "não vi sua marcação", nunca como "você não cumpriu".',
  paramsSchema: z
    .object({
      itemId: z.string().min(1).max(60),
      dias: z.number().int().min(1).max(31),
    })
    .strict(),
  fields: [
    { name: 'itemId', label: 'Qual hábito', kind: 'select', optionsFrom: 'habit_items' },
    {
      name: 'dias',
      label: 'Dias seguidos sem marcação',
      kind: 'number',
      min: 1,
      max: 31,
      defaultValue: 3,
    },
  ],
  variables: ['habito', 'dias'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { itemId, dias } = ctx.params as { itemId: string; dias: number }
    const out: SourceCandidate[] = []

    for (const c of await checklistsComItem(ctx, itemId)) {
      const periodo = currentPeriod(c.start_date, c.period_kind as PeriodKind, ctx.today)

      // A janela de ausência é limitada ao período corrente: um checklist que
      // começou ontem não pode acusar "5 dias sem marcar".
      const inicioJanela =
        periodo.days.find((d) => d >= addDaysIso(ctx.today, -(dias - 1))) ?? periodo.startDate
      const diasDaJanela = periodo.days.filter((d) => d >= inicioJanela && d <= ctx.today)
      if (diasDaJanela.length < dias) continue

      const marcas = await marcasNoIntervalo(ctx, c.id, itemId, inicioJanela, ctx.today)
      if (marcas.length > 0) continue

      out.push({
        patientId: c.patient_id,
        occurrenceKey: `${c.id}:P${periodo.index}`,
        variables: { habito: c.label, dias: String(dias) },
      })
    }
    return out
  },
})

function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000
  const dt = new Date(t)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`
}
