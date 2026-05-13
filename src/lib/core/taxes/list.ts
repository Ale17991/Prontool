import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { bpsToPercent } from '@/lib/validation/rate-bps'
import type { TaxCategory, TaxRow } from './create'

/**
 * T022 — Feature 011 — lista impostos do tenant.
 *
 * Filtros:
 *  - includeInactive (default false): se true, retorna também is_active=false.
 *  - category: filtra por categoria (municipal/estadual/federal/outro).
 *
 * Ordena: is_active DESC (ativos primeiro), depois name ASC (case-insensitive).
 * Sempre filtra deleted_at IS NULL (soft-delete oculto).
 */
export interface ListTaxesInput {
  tenantId: string
  includeInactive?: boolean
  category?: TaxCategory
}

export interface ListedTax extends TaxRow {
  rate_percent: string // derivado server-side via bpsToPercent (pt-BR)
}

export async function listTaxes(
  supabase: SupabaseClient<Database>,
  input: ListTaxesInput,
): Promise<ListedTax[]> {
  let q = supabase
    .from('taxes' as never)
    .select(
      'id, tenant_id, name, rate_bps, description, category, is_active, created_at, created_by, deleted_at, deleted_by',
    )
    .eq('tenant_id', input.tenantId)
    .is('deleted_at', null)
    .order('is_active', { ascending: false })
    .order('name', { ascending: true })

  if (!input.includeInactive) {
    q = q.eq('is_active', true)
  }
  if (input.category) {
    q = q.eq('category', input.category)
  }

  const { data, error } = await q
  if (error) throw new Error(`listTaxes failed: ${error.message}`)
  return ((data ?? []) as unknown as TaxRow[]).map((r) => ({
    ...r,
    rate_percent: bpsToPercent(r.rate_bps),
  }))
}
