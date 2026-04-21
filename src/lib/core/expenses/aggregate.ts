import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface ExpenseAggregation {
  expensesByCategory: Record<string, number>
  totalExpensesCents: number
}

export async function aggregateExpenses(
  supabase: SupabaseClient<Database>,
  params: {
    tenantId: string
    startDate: string
    endDate: string
  },
): Promise<ExpenseAggregation> {
  const { data, error } = await supabase
    .from('expenses')
    .select('category, amount_cents')
    .eq('tenant_id', params.tenantId)
    .gte('competence_date', params.startDate)
    .lte('competence_date', params.endDate)
    .is('deleted_at', null)

  if (error) throw new Error(`aggregateExpenses failed: ${error.message}`)

  const result: ExpenseAggregation = {
    expensesByCategory: {},
    totalExpensesCents: 0,
  }

  for (const row of data ?? []) {
    const amount = Number(row.amount_cents)
    result.totalExpensesCents += amount
    result.expensesByCategory[row.category] =
      (result.expensesByCategory[row.category] ?? 0) + amount
  }

  return result
}
