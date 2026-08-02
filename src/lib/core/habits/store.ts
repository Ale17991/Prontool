import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  currentPeriod,
  isWithin,
  itemStats,
  periodAt,
  periodIndexFor,
  type HabitItem,
  type HabitMark,
  type ItemStats,
  type Period,
  type PeriodKind,
} from './period'

/**
 * Checklist de hábitos — persistência.
 *
 * A escrita do PACIENTE entra por aqui (`toggleMark`) com tenant e paciente
 * resolvidos da sessão do portal, nunca do corpo do pedido. É a primeira vez
 * que o portal aceita escrita: a regra de ouro é que nada vindo do cliente
 * decide DE QUEM é o dado.
 */

function loose(sb: SupabaseClient<Database>): SupabaseClient {
  return sb as unknown as SupabaseClient
}

export interface ChecklistTemplate {
  id: string
  title: string
  items: HabitItem[]
  active: boolean
}

export interface PatientChecklist {
  id: string
  patientId: string
  title: string
  periodKind: PeriodKind
  startDate: string
  items: HabitItem[]
  active: boolean
}

export interface ChecklistGrid {
  checklist: PatientChecklist
  period: Period
  /** Marcações do período corrente. */
  marks: HabitMark[]
  stats: ItemStats[]
  /** Índice do período exibido — o histórico usa índices anteriores. */
  periodIndex: number
}

function parseItems(v: unknown): HabitItem[] {
  if (!Array.isArray(v)) return []
  const out: HabitItem[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    const label = typeof o.label === 'string' ? o.label : null
    if (id && label) out.push({ id, label })
  }
  return out
}

// ---- modelos da clínica -------------------------------------------------

export async function listTemplates(
  sb: SupabaseClient<Database>,
  tenantId: string,
): Promise<ChecklistTemplate[]> {
  const res = await loose(sb)
    .from('habit_checklist_templates')
    .select('id, title, items, active')
    .eq('tenant_id', tenantId)
    .order('title', { ascending: true })
  return ((res.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    items: parseItems(r.items),
    active: r.active as boolean,
  }))
}

export async function saveTemplate(
  sb: SupabaseClient<Database>,
  args: { tenantId: string; id?: string | null; title: string; items: HabitItem[]; active?: boolean },
): Promise<{ id: string }> {
  const c = loose(sb)
  const payload = {
    title: args.title.trim(),
    items: args.items,
    active: args.active ?? true,
  }
  if (args.id) {
    const upd = await c
      .from('habit_checklist_templates')
      .update(payload)
      .eq('tenant_id', args.tenantId)
      .eq('id', args.id)
    if (upd.error) throw new Error(`saveTemplate: ${upd.error.message}`)
    return { id: args.id }
  }
  const ins = await c
    .from('habit_checklist_templates')
    .insert({ tenant_id: args.tenantId, ...payload })
    .select('id')
    .single()
  if (ins.error) throw new Error(`saveTemplate: ${ins.error.message}`)
  return { id: (ins.data as { id: string }).id }
}

export async function deleteTemplate(
  sb: SupabaseClient<Database>,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const res = await loose(sb)
    .from('habit_checklist_templates')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select('id')
  return ((res.data ?? []) as unknown[]).length > 0
}

// ---- checklist do paciente ----------------------------------------------

export async function getActiveChecklist(
  sb: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<PatientChecklist | null> {
  const res = await loose(sb)
    .from('patient_habit_checklists')
    .select('id, patient_id, title, period_kind, start_date, items, active')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const r = res.data as Record<string, unknown> | null
  if (!r) return null
  return {
    id: r.id as string,
    patientId: r.patient_id as string,
    title: r.title as string,
    periodKind: r.period_kind as PeriodKind,
    startDate: String(r.start_date).slice(0, 10),
    items: parseItems(r.items),
    active: r.active as boolean,
  }
}

export async function saveChecklist(
  sb: SupabaseClient<Database>,
  args: {
    tenantId: string
    patientId: string
    actorUserId: string
    id?: string | null
    title: string
    periodKind: PeriodKind
    startDate: string
    items: HabitItem[]
    active?: boolean
  },
): Promise<{ id: string }> {
  const c = loose(sb)
  const payload = {
    title: args.title.trim(),
    period_kind: args.periodKind,
    start_date: args.startDate,
    items: args.items,
    active: args.active ?? true,
  }
  if (args.id) {
    const upd = await c
      .from('patient_habit_checklists')
      .update(payload)
      .eq('tenant_id', args.tenantId)
      .eq('id', args.id)
    if (upd.error) throw new Error(`saveChecklist: ${upd.error.message}`)
    return { id: args.id }
  }
  // Um checklist ativo por paciente: o novo aposenta o anterior em vez de
  // apagá-lo, para as marcações antigas seguirem existindo como histórico.
  await c
    .from('patient_habit_checklists')
    .update({ active: false })
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .eq('active', true)

  const ins = await c
    .from('patient_habit_checklists')
    .insert({
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      created_by_user_id: args.actorUserId,
      ...payload,
    })
    .select('id')
    .single()
  if (ins.error) throw new Error(`saveChecklist: ${ins.error.message}`)
  return { id: (ins.data as { id: string }).id }
}

// ---- marcações -----------------------------------------------------------

async function loadMarks(
  sb: SupabaseClient<Database>,
  checklistId: string,
  fromDate: string,
  toDate: string,
): Promise<HabitMark[]> {
  const res = await loose(sb)
    .from('habit_checklist_marks')
    .select('item_id, mark_date')
    .eq('checklist_id', checklistId)
    .gte('mark_date', fromDate)
    .lte('mark_date', toDate)
  return ((res.data ?? []) as Array<{ item_id: string; mark_date: string }>).map((r) => ({
    itemId: r.item_id,
    markDate: String(r.mark_date).slice(0, 10),
  }))
}

/**
 * A grade de um período. `periodIndex` omitido = período corrente; passar um
 * índice anterior é como o histórico é lido — não há tabela de períodos.
 */
export async function getGrid(
  sb: SupabaseClient<Database>,
  args: {
    tenantId: string
    patientId: string
    today: string
    periodIndex?: number | null
  },
): Promise<ChecklistGrid | null> {
  const checklist = await getActiveChecklist(sb, args.tenantId, args.patientId)
  if (!checklist) return null

  const currentIdx = periodIndexFor(checklist.startDate, checklist.periodKind, args.today)
  const idx = args.periodIndex ?? Math.max(0, currentIdx)
  const period =
    idx === currentIdx
      ? currentPeriod(checklist.startDate, checklist.periodKind, args.today)
      : periodAt(checklist.startDate, checklist.periodKind, Math.max(0, idx))

  const marks = await loadMarks(sb, checklist.id, period.startDate, period.endDate)
  return {
    checklist,
    period,
    marks,
    stats: itemStats({
      items: checklist.items,
      marks,
      days: period.days,
      today: args.today,
    }),
    periodIndex: period.index,
  }
}

export class HabitMarkError extends Error {
  constructor(
    readonly code: 'NO_CHECKLIST' | 'UNKNOWN_ITEM' | 'DATE_OUT_OF_PERIOD',
    message: string,
  ) {
    super(message)
    this.name = 'HabitMarkError'
  }
}

/**
 * Marca ou desmarca (item × dia). Idempotente nas duas direções.
 *
 * Aceita data retroativa DENTRO do período corrente — no papel a pessoa
 * preenche a semana no domingo, e travar em "só hoje" faria abandonar. Fora do
 * período corrente é recusado: reescrever período fechado corromperia o
 * histórico que a clínica lê.
 */
export async function toggleMark(
  sb: SupabaseClient<Database>,
  args: {
    tenantId: string
    patientId: string
    itemId: string
    markDate: string
    marked: boolean
    today: string
    markedBy?: 'paciente' | 'equipe'
  },
): Promise<{ marked: boolean }> {
  const checklist = await getActiveChecklist(sb, args.tenantId, args.patientId)
  if (!checklist) throw new HabitMarkError('NO_CHECKLIST', 'Nenhum checklist ativo.')

  if (!checklist.items.some((i) => i.id === args.itemId)) {
    // Item que não está na grade DESTE paciente não pode ser marcado — senão um
    // pedido forjado criaria marcação de hábito inexistente.
    throw new HabitMarkError('UNKNOWN_ITEM', 'Hábito não faz parte deste checklist.')
  }

  const period = currentPeriod(checklist.startDate, checklist.periodKind, args.today)
  if (!isWithin(period, args.markDate)) {
    throw new HabitMarkError(
      'DATE_OUT_OF_PERIOD',
      'Só é possível marcar dias do período atual.',
    )
  }

  const c = loose(sb)
  if (!args.marked) {
    await c
      .from('habit_checklist_marks')
      .delete()
      .eq('tenant_id', args.tenantId)
      .eq('checklist_id', checklist.id)
      .eq('item_id', args.itemId)
      .eq('mark_date', args.markDate)
    return { marked: false }
  }

  const ins = await c.from('habit_checklist_marks').insert({
    tenant_id: args.tenantId,
    checklist_id: checklist.id,
    patient_id: args.patientId,
    item_id: args.itemId,
    mark_date: args.markDate,
    marked_by: args.markedBy ?? 'paciente',
  })
  // 23505 = já existe. Marcar duas vezes é a mesma afirmação, não um erro.
  if (ins.error && ins.error.code !== '23505') {
    throw new Error(`toggleMark: ${ins.error.message}`)
  }
  return { marked: true }
}

export interface PeriodSummary {
  periodIndex: number
  startDate: string
  endDate: string
  stats: ItemStats[]
}

/**
 * Histórico: os `count` períodos anteriores ao corrente, do mais recente para o
 * mais antigo. Períodos antes do início do checklist não são inventados.
 */
export async function getHistory(
  sb: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; today: string; count?: number },
): Promise<PeriodSummary[]> {
  const checklist = await getActiveChecklist(sb, args.tenantId, args.patientId)
  if (!checklist) return []

  const currentIdx = Math.max(0, periodIndexFor(checklist.startDate, checklist.periodKind, args.today))
  const count = Math.min(args.count ?? 6, 24)
  const out: PeriodSummary[] = []

  for (let i = currentIdx - 1; i >= 0 && out.length < count; i--) {
    const period = periodAt(checklist.startDate, checklist.periodKind, i)
    const marks = await loadMarks(sb, checklist.id, period.startDate, period.endDate)
    out.push({
      periodIndex: i,
      startDate: period.startDate,
      endDate: period.endDate,
      stats: itemStats({
        items: checklist.items,
        marks,
        days: period.days,
        // Período encerrado: todos os dias já passaram.
        today: period.endDate,
      }),
    })
  }
  return out
}
