import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { ExpenseCategory } from './create'

export interface ListExpensesFilter {
  tenantId: string
  category?: ExpenseCategory | 'all'
  startDate?: string
  endDate?: string
  includeDeleted?: boolean
}

export async function listExpenses(
  supabase: SupabaseClient<Database>,
  filter: ListExpensesFilter,
) {
  let query = supabase
    .from('expenses')
    .select('*')
    .eq('tenant_id', filter.tenantId)
    .order('competence_date', { ascending: false })

  if (filter.category && filter.category !== 'all') {
    query = query.eq('category', filter.category)
  }

  if (filter.startDate) query = query.gte('competence_date', filter.startDate)
  if (filter.endDate) query = query.lte('competence_date', filter.endDate)

  if (!filter.includeDeleted) {
    query = query.is('deleted_at', null)
  }

  const { data, error } = await query
  if (error) throw new Error(`listExpenses failed: ${error.message}`)
  return data ?? []
}
