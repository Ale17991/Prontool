import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { startOfWeek, startOfMonth, format, parseISO } from 'date-fns'
import { projectRecurringExpenses } from '@/lib/core/accounts-payable'
import { tenantCashBalanceAt } from '@/lib/core/cash-balance'

export type CashFlowScale = 'daily' | 'weekly' | 'monthly'

export interface CashFlowEvent {
  date: string  // YYYY-MM-DD
  type: 'entry' | 'exit'
  description: string
  amountCents: number  // sempre positivo; type indica direção
  source: 'installment' | 'expense'
  sourceId: string
  isProjection: boolean
}

export interface CashFlowBucket {
  key: string
  entriesCents: number
  exitsCents: number
  deltaCents: number
  balanceAfterCents: number
}

export interface CashFlowResult {
  startingBalanceCents: number
  events: CashFlowEvent[]
  buckets: CashFlowBucket[]
  scale: CashFlowScale
}

export async function assembleCashFlow(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    from: string
    to: string
    scale: CashFlowScale
  },
): Promise<CashFlowResult> {
  // 1. Saldo inicial em D-1
  const fromDate = parseISO(args.from + 'T00:00:00')
  const dayBefore = format(new Date(fromDate.getTime() - 86400000), 'yyyy-MM-dd')
  const startingBalance = await tenantCashBalanceAt(supabase, {
    tenantId: args.tenantId,
    date: dayBefore,
  })

  // 2. Parcelas (entradas) — pagas no range OU pendentes com due_date no range
  const events: CashFlowEvent[] = []
  const insRes = await supabase
    .from('payment_installments' as never)
    .select(
      'id, amount_cents, paid_amount_cents, due_date, status, paid_at, payment_records!inner(patients(anonymized_at))',
    )
    .eq('tenant_id', args.tenantId)
    .gte('due_date', args.from)
    .lte('due_date', args.to)
  if (!insRes.error && insRes.data) {
    for (const row of insRes.data as unknown as Array<{
      id: string
      amount_cents: number
      paid_amount_cents: number
      due_date: string
      status: string
      paid_at: string | null
      payment_records: { patients: { anonymized_at: string | null } | null } | null
    }>) {
      const amount = Number(row.amount_cents)
      const paid = Number(row.paid_amount_cents)
      const isAnon = row.payment_records?.patients?.anonymized_at !== null
        && row.payment_records?.patients?.anonymized_at !== undefined
      if (row.status === 'pago' && row.paid_at) {
        events.push({
          date: row.paid_at.slice(0, 10),
          type: 'entry',
          description: isAnon ? 'Pagamento parcela [anonimizado]' : 'Pagamento de parcela',
          amountCents: paid,
          source: 'installment',
          sourceId: row.id,
          isProjection: false,
        })
      } else if (amount - paid > 0) {
        events.push({
          date: row.due_date,
          type: 'entry',
          description: isAnon ? 'Previsto: parcela [anonimizado]' : 'Previsto: parcela pendente',
          amountCents: amount - paid,
          source: 'installment',
          sourceId: row.id,
          isProjection: true,
        })
      }
    }
  }

  // 3. Despesas (saídas) — pagas no range OU pendentes com competence no range
  const expRes = await supabase
    .from('expenses')
    .select(
      'id, description, amount_cents, paid_amount_cents, competence_date, paid_at, recurring, recurring_starts_at, recurring_ends_at, superseded_by, frequency, supplier, category, deleted_at',
    )
    .eq('tenant_id', args.tenantId)
    .is('deleted_at', null)
  if (!expRes.error && expRes.data) {
    const allExpenses = expRes.data as unknown as Array<{
      id: string
      description: string
      amount_cents: number
      paid_amount_cents: number | null
      competence_date: string
      paid_at: string | null
      recurring: boolean
      recurring_starts_at: string | null
      recurring_ends_at: string | null
      superseded_by: string | null
      frequency: string | null
      supplier: string | null
      category: string
      deleted_at: string | null
    }>
    for (const e of allExpenses) {
      if (e.superseded_by) continue
      if (e.competence_date < args.from || e.competence_date > args.to) continue
      const amount = Number(e.amount_cents)
      const paid = Number(e.paid_amount_cents ?? 0)
      if (e.paid_at) {
        events.push({
          date: e.paid_at.slice(0, 10),
          type: 'exit',
          description: e.description,
          amountCents: paid || amount,
          source: 'expense',
          sourceId: e.id,
          isProjection: false,
        })
      } else {
        events.push({
          date: e.competence_date,
          type: 'exit',
          description: 'Previsto: ' + e.description,
          amountCents: amount,
          source: 'expense',
          sourceId: e.id,
          isProjection: true,
        })
      }
    }
    // Projeções recorrentes — cast com colunas completas
    const projections = projectRecurringExpenses(
      allExpenses.map((e) => ({
        ...e,
        tenant_id: args.tenantId,
        payment_method: null,
      })) as never,
      args.from,
      args.to,
    )
    for (const p of projections) {
      events.push({
        date: p.competenceDate,
        type: 'exit',
        description: p.description,
        amountCents: p.amountCents,
        source: 'expense',
        sourceId: p.parentId ?? p.id,
        isProjection: true,
      })
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date))

  // 4. Agregação em buckets
  const buckets = aggregateByScale(events, args.scale, startingBalance)

  return {
    startingBalanceCents: startingBalance,
    events,
    buckets,
    scale: args.scale,
  }
}

export function aggregateByScale(
  events: CashFlowEvent[],
  scale: CashFlowScale,
  startingBalance: number,
): CashFlowBucket[] {
  function bucketKey(dateIso: string): string {
    const d = parseISO(dateIso + 'T00:00:00')
    if (scale === 'daily') return dateIso
    if (scale === 'weekly') return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    return format(startOfMonth(d), 'yyyy-MM')
  }

  const map = new Map<string, { entries: number; exits: number }>()
  for (const ev of events) {
    const k = bucketKey(ev.date)
    const cur = map.get(k) ?? { entries: 0, exits: 0 }
    if (ev.type === 'entry') cur.entries += ev.amountCents
    else cur.exits += ev.amountCents
    map.set(k, cur)
  }

  const keys = [...map.keys()].sort()
  let balance = startingBalance
  const buckets: CashFlowBucket[] = []
  for (const k of keys) {
    const { entries, exits } = map.get(k)!
    const delta = entries - exits
    balance += delta
    buckets.push({
      key: k,
      entriesCents: entries,
      exitsCents: exits,
      deltaCents: delta,
      balanceAfterCents: balance,
    })
  }
  return buckets
}
