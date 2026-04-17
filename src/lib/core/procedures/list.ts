import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * T162 — Lista procedimentos do tenant, com a descrição TUSS resolvida
 * do catálogo global.
 */
export interface ListedProcedure {
  id: string
  tussCode: string
  tussDescription: string | null
  displayName: string | null
  active: boolean
  createdAt: string
}

interface JoinedRow {
  id: string
  tuss_code: string
  display_name: string | null
  active: boolean
  created_at: string
  tuss_codes: { description: string } | null
}

export async function listProcedures(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; includeInactive?: boolean },
): Promise<ListedProcedure[]> {
  let q = supabase
    .from('procedures')
    .select('id, tuss_code, display_name, active, created_at, tuss_codes!procedures_tuss_code_fkey(description)')
    .eq('tenant_id', args.tenantId)
    .order('created_at', { ascending: false })
  if (!args.includeInactive) q = q.eq('active', true)

  const { data, error } = await q
  if (error) throw new Error(`listProcedures failed: ${error.message}`)

  return ((data ?? []) as unknown as JoinedRow[]).map((r) => ({
    id: r.id,
    tussCode: r.tuss_code,
    tussDescription: r.tuss_codes?.description ?? null,
    displayName: r.display_name,
    active: r.active,
    createdAt: r.created_at,
  }))
}
