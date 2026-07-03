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

export async function listExpenses(supabase: SupabaseClient<Database>, filter: ListExpensesFilter) {
  // Feature 011 — US3: projeta tax (nome) via join leve quando há vínculo.
  let query = supabase
    .from('expenses')
    .select('*, tax:taxes!tax_id(id, name)')
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
  // Achata `tax.name` em `tax_name` para o consumidor (mais ergonômico
  // que tax?.name na UI).
  return (data ?? []).map((row) => {
    const tax = (row as { tax?: { id: string; name: string } | null }).tax ?? null
    return {
      ...row,
      tax_name: tax?.name ?? null,
    }
  })
}
