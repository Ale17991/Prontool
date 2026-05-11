import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * T162 — Lista procedimentos do tenant, com a descrição TUSS resolvida
 * do catálogo global.
 */
export interface ListedProcedure {
  id: string
  /** null quando isUnlisted=true (procedimento local sem TUSS). */
  tussCode: string | null
  tussDescription: string | null
  displayName: string | null
  active: boolean
  createdAt: string
  defaultAmountCents: number | null
  coveredByPlan: boolean
  isUnlisted: boolean
}

interface JoinedRow {
  id: string
  tuss_code: string | null
  display_name: string | null
  active: boolean
  created_at: string
  default_amount_cents: number | null
  covered_by_plan: boolean
  is_unlisted: boolean
  tuss_codes: { description: string } | null
}

export async function listProcedures(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; includeInactive?: boolean; onlyCoveredByPlan?: boolean },
): Promise<ListedProcedure[]> {
  let q = supabase
    .from('procedures')
    .select(
      'id, tuss_code, display_name, active, created_at, default_amount_cents, covered_by_plan, is_unlisted, tuss_codes!procedures_tuss_code_fkey(description)',
    )
    .eq('tenant_id', args.tenantId)
    .order('created_at', { ascending: false })
  if (!args.includeInactive) q = q.eq('active', true)
  if (args.onlyCoveredByPlan) q = q.eq('covered_by_plan', true)

  const { data, error } = await q
  if (error) throw new Error(`listProcedures failed: ${error.message}`)

  return ((data ?? []) as unknown as JoinedRow[]).map((r) => ({
    id: r.id,
    tussCode: r.tuss_code,
    tussDescription: r.tuss_codes?.description ?? null,
    displayName: r.display_name,
    active: r.active,
    createdAt: r.created_at,
    defaultAmountCents: r.default_amount_cents,
    coveredByPlan: r.covered_by_plan,
    isUnlisted: r.is_unlisted,
  }))
}
