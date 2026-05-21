import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { addDays, addMonths, addWeeks, addYears, format, parseISO } from 'date-fns'
import { ValidationError, NotFoundError } from '@/lib/observability/errors'

export type PayableStatus = 'a_vencer' | 'vencida' | 'paga'

export interface PayableRow {
  id: string
  isProjection: boolean
  parentId: string | null
  description: string
  category: string
  supplier: string | null
  amountCents: number
  paidAmountCents: number
  paymentMethod: string | null
  competenceDate: string
  paidAt: string | null
  status: PayableStatus
  recurring: boolean
  frequency: string | null
  recurringStartsAt: string | null
  recurringEndsAt: string | null
  supersededBy: string | null
  hasReceipt: boolean
}

export interface PayableFilters {
  tenantId: string
  from?: string | null
  to?: string | null
  category?: string | null
  supplierContains?: string | null
  status?: PayableStatus | 'all'
  includeProjections?: boolean
}

interface DbExpense {
  id: string
  tenant_id: string
  category: string
  description: string
  supplier: string | null
  amount_cents: number
  competence_date: string
  recurring: boolean
  frequency: string | null
  paid_at: string | null
  paid_amount_cents: number | null
  payment_method: string | null
  recurring_starts_at: string | null
  recurring_ends_at: string | null
  superseded_by: string | null
  deleted_at: string | null
  has_receipt?: boolean | null
}

function statusOf(row: DbExpense, today: string): PayableStatus {
  if (row.paid_at) return 'paga'
  if (row.competence_date < today) return 'vencida'
  return 'a_vencer'
}

function addByFrequency(date: Date, frequency: string | null): Date {
  if (frequency === 'mensal') return addMonths(date, 1)
  if (frequency === 'semanal') return addWeeks(date, 1)
  if (frequency === 'anual') return addYears(date, 1)
  return addMonths(date, 1)
}

/**
 * Projeta despesas recorrentes ativas no intervalo [from, to].
 * Respeita: recurring=true, recurring_starts_at, recurring_ends_at,
 * superseded_by IS NULL (despesas substituidas nao projetam).
 * Funcao pura — testavel sem DB.
 */
export function projectRecurringExpenses(
  expenses: DbExpense[],
  fromIso: string,
  toIso: string,
): PayableRow[] {
  const from = parseISO(fromIso + 'T00:00:00')
  const to = parseISO(toIso + 'T00:00:00')
  const today = format(new Date(), 'yyyy-MM-dd')
  const out: PayableRow[] = []

  for (const exp of expenses) {
    if (!exp.recurring) continue
    if (exp.deleted_at) continue
    if (exp.superseded_by) continue
    const startsAt = exp.recurring_starts_at ?? exp.competence_date
    const endsAt = exp.recurring_ends_at
    let cursor = parseISO(startsAt + 'T00:00:00')
    // Avança cursor até from
    while (cursor < from) {
      cursor = addByFrequency(cursor, exp.frequency)
    }
    while (cursor <= to) {
      const cursorIso = format(cursor, 'yyyy-MM-dd')
      if (endsAt && cursorIso > endsAt) break
      // Não projeta o mês original (já está na lista como expense original)
      if (cursorIso !== exp.competence_date) {
        out.push({
          id: `projection:${exp.id}:${cursorIso}`,
          isProjection: true,
          parentId: exp.id,
          description: exp.description + ' (projeção)',
          category: exp.category,
          supplier: exp.supplier,
          amountCents: Number(exp.amount_cents),
          paidAmountCents: 0,
          paymentMethod: null,
          competenceDate: cursorIso,
          paidAt: null,
          status: cursorIso < today ? 'vencida' : 'a_vencer',
          recurring: true,
          frequency: exp.frequency,
          recurringStartsAt: exp.recurring_starts_at,
          recurringEndsAt: exp.recurring_ends_at,
          supersededBy: null,
          hasReceipt: false,
        })
      }
      cursor = addByFrequency(cursor, exp.frequency)
    }
  }
  return out
}

export interface PayableSummary {
  totalPendingCents: number
  totalPaidCents: number
  byCategory: Record<string, number>
}

export async function listPayablesWithProjections(
  supabase: SupabaseClient<Database>,
  filters: PayableFilters,
): Promise<{ rows: PayableRow[]; summary: PayableSummary }> {
  const today = format(new Date(), 'yyyy-MM-dd')
  const fromIso = filters.from ?? format(addDays(new Date(), -30), 'yyyy-MM-dd')
  const toIso = filters.to ?? format(addDays(new Date(), 90), 'yyyy-MM-dd')

  let q = supabase
    .from('expenses')
    .select(
      'id, tenant_id, category, description, supplier, amount_cents, competence_date, recurring, frequency, paid_at, paid_amount_cents, payment_method, recurring_starts_at, recurring_ends_at, superseded_by, deleted_at',
    )
    .eq('tenant_id', filters.tenantId)
    .is('deleted_at', null)
    .order('competence_date', { ascending: true })

  if (filters.category) q = q.eq('category', filters.category)
  if (filters.supplierContains) q = q.ilike('supplier', `%${filters.supplierContains}%`)

  const { data, error } = await q
  if (error) throw new Error(`list payables: ${error.message}`)
  const allExpenses = (data ?? []) as unknown as DbExpense[]

  // Despesas reais no range
  const realRows: PayableRow[] = allExpenses
    .filter(
      (e) =>
        e.competence_date >= fromIso &&
        e.competence_date <= toIso &&
        !e.superseded_by,
    )
    .map((e) => ({
      id: e.id,
      isProjection: false,
      parentId: null,
      description: e.description,
      category: e.category,
      supplier: e.supplier,
      amountCents: Number(e.amount_cents),
      paidAmountCents: Number(e.paid_amount_cents ?? 0),
      paymentMethod: e.payment_method,
      competenceDate: e.competence_date,
      paidAt: e.paid_at,
      status: statusOf(e, today),
      recurring: e.recurring,
      frequency: e.frequency,
      recurringStartsAt: e.recurring_starts_at,
      recurringEndsAt: e.recurring_ends_at,
      supersededBy: e.superseded_by,
      hasReceipt: false,
    }))

  // Projeções
  const projections = filters.includeProjections === false
    ? []
    : projectRecurringExpenses(allExpenses, fromIso, toIso)

  let rows: PayableRow[] = [...realRows, ...projections]

  if (filters.status && filters.status !== 'all') {
    rows = rows.filter((r) => r.status === filters.status)
  }
  rows.sort((a, b) => a.competenceDate.localeCompare(b.competenceDate))

  const summary: PayableSummary = {
    totalPendingCents: rows
      .filter((r) => r.status !== 'paga')
      .reduce((s, r) => s + r.amountCents, 0),
    totalPaidCents: rows
      .filter((r) => r.status === 'paga')
      .reduce((s, r) => s + r.paidAmountCents, 0),
    byCategory: rows.reduce<Record<string, number>>((acc, r) => {
      if (r.status !== 'paga') {
        acc[r.category] = (acc[r.category] ?? 0) + r.amountCents
      }
      return acc
    }, {}),
  }
  return { rows, summary }
}

export interface MarkExpensePaidInput {
  tenantId: string
  expenseId: string
  paidAt: string
  paidAmountCents: number
  paymentMethod: string
  actorUserId: string
}

export async function markExpensePaid(
  supabase: SupabaseClient<Database>,
  input: MarkExpensePaidInput,
): Promise<void> {
  if (input.paidAmountCents <= 0) {
    throw new ValidationError('paid_amount_cents must be > 0')
  }
  const cur = await supabase
    .from('expenses')
    .select('paid_at, amount_cents, tenant_id')
    .eq('id', input.expenseId)
    .maybeSingle()
  if (cur.error || !cur.data) throw new NotFoundError('expense', input.expenseId)
  const row = cur.data as { paid_at: string | null; amount_cents: number; tenant_id: string }
  if (row.tenant_id !== input.tenantId) throw new NotFoundError('expense', input.expenseId)
  if (row.paid_at) throw new ValidationError('expense already paid')

  const upd = await supabase
    .from('expenses')
    .update({
      paid_at: input.paidAt,
      paid_amount_cents: input.paidAmountCents,
      payment_method: input.paymentMethod,
    } as never)
    .eq('id', input.expenseId)
    .eq('tenant_id', input.tenantId)
  if (upd.error) throw new Error(`mark paid: ${upd.error.message}`)

  await supabase.rpc('log_audit_event' as never, {
    p_tenant_id: input.tenantId,
    p_entity: 'expenses',
    p_entity_id: input.expenseId,
    p_field: 'paid_at',
    p_old: null,
    p_new: input.paidAt,
    p_reason: `paid via /api/financeiro/contas-a-pagar; method=${input.paymentMethod}`,
  } as never)
}

export interface VersionExpenseInput {
  tenantId: string
  expenseId: string
  effectiveFrom: string  // YYYY-MM-DD
  newAmountCents: number
  reason: string
  actorUserId: string
}

export async function versionRecurringExpense(
  supabase: SupabaseClient<Database>,
  input: VersionExpenseInput,
): Promise<{ newExpenseId: string }> {
  if (input.reason.trim().length < 3) {
    throw new ValidationError('reason must be at least 3 characters')
  }
  if (input.newAmountCents <= 0) {
    throw new ValidationError('new_amount_cents must be > 0')
  }

  // Buscar a despesa atual
  const cur = await supabase
    .from('expenses')
    .select('*')
    .eq('id', input.expenseId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (cur.error || !cur.data) throw new NotFoundError('expense', input.expenseId)
  const oldRow = cur.data as unknown as DbExpense & {
    tax_id?: string | null
  }
  if (!oldRow.recurring) {
    throw new ValidationError('only recurring expenses can be versioned')
  }
  if (oldRow.superseded_by) {
    throw new ValidationError('this expense has already been versioned')
  }

  const cutoff = parseISO(input.effectiveFrom + 'T00:00:00')
  const endsAtPrev = format(addDays(cutoff, -1), 'yyyy-MM-dd')

  // 1. INSERT nova versão
  const ins = await supabase
    .from('expenses')
    .insert({
      tenant_id: input.tenantId,
      category: oldRow.category,
      description: oldRow.description,
      supplier: oldRow.supplier,
      amount_cents: input.newAmountCents,
      competence_date: input.effectiveFrom,
      recurring: true,
      frequency: oldRow.frequency,
      recurring_starts_at: input.effectiveFrom,
      created_by: input.actorUserId,
      tax_id: oldRow.tax_id ?? null,
    } as never)
    .select('id')
    .single()
  if (ins.error || !ins.data) throw new Error(`version insert: ${ins.error?.message}`)
  const newId = (ins.data as { id: string }).id

  // 2. UPDATE antiga: recurring_ends_at + superseded_by
  const upd = await supabase
    .from('expenses')
    .update({
      recurring_ends_at: endsAtPrev,
      superseded_by: newId,
    } as never)
    .eq('id', input.expenseId)
    .eq('tenant_id', input.tenantId)
  if (upd.error) throw new Error(`version update old: ${upd.error.message}`)

  // 3. Audit
  await supabase.rpc('log_audit_event' as never, {
    p_tenant_id: input.tenantId,
    p_entity: 'expenses',
    p_entity_id: input.expenseId,
    p_field: 'recurring.versioned',
    p_old: oldRow.amount_cents.toString(),
    p_new: input.newAmountCents.toString(),
    p_reason: `${input.reason} | new_id=${newId} | effective_from=${input.effectiveFrom}`,
  } as never)

  return { newExpenseId: newId }
}

export async function endRecurringExpense(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    expenseId: string
    endsAt: string
    actorUserId: string
  },
): Promise<void> {
  const upd = await supabase
    .from('expenses')
    .update({ recurring_ends_at: args.endsAt } as never)
    .eq('id', args.expenseId)
    .eq('tenant_id', args.tenantId)
  if (upd.error) throw new Error(`end recurring: ${upd.error.message}`)
  await supabase.rpc('log_audit_event' as never, {
    p_tenant_id: args.tenantId,
    p_entity: 'expenses',
    p_entity_id: args.expenseId,
    p_field: 'recurring_ends_at',
    p_old: null,
    p_new: args.endsAt,
    p_reason: 'recurring expense terminated (no versioning)',
  } as never)
}
