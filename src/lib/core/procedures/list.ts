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
  defaultAmountCents: number | null
  coveredByPlan: boolean
}

interface ProcedureRow {
  id: string
  tuss_code: string
  display_name: string | null
  active: boolean
  created_at: string
  default_amount_cents: number | null
  covered_by_plan: boolean
}

export async function listProcedures(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; includeInactive?: boolean; onlyCoveredByPlan?: boolean },
): Promise<ListedProcedure[]> {
  // Não tentamos usar `tuss_codes!procedures_tuss_code_fkey(description)` como
  // embed do PostgREST: `procedures.tuss_code` é só TEXT sem FK (ver
  // migration 0004). Fazemos duas queries e juntamos em memória — o catálogo
  // TUSS é compacto o suficiente para isso não importar.
  let q = supabase
    .from('procedures')
    .select(
      'id, tuss_code, display_name, active, created_at, default_amount_cents, covered_by_plan',
    )
    .eq('tenant_id', args.tenantId)
    .order('created_at', { ascending: false })
  if (!args.includeInactive) q = q.eq('active', true)
  if (args.onlyCoveredByPlan) q = q.eq('covered_by_plan', true)

  const { data, error } = await q
  if (error) throw new Error(`listProcedures failed: ${error.message}`)

  const rows = (data ?? []) as unknown as ProcedureRow[]
  if (rows.length === 0) return []

  const uniqueCodes = Array.from(new Set(rows.map((r) => r.tuss_code)))
  const descriptions = await fetchTussDescriptions(supabase, uniqueCodes)

  return rows.map((r) => ({
    id: r.id,
    tussCode: r.tuss_code,
    tussDescription: descriptions.get(r.tuss_code) ?? null,
    displayName: r.display_name,
    active: r.active,
    createdAt: r.created_at,
    defaultAmountCents: r.default_amount_cents,
    coveredByPlan: r.covered_by_plan,
  }))
}

async function fetchTussDescriptions(
  supabase: SupabaseClient<Database>,
  codes: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (codes.length === 0) return out
  const { data, error } = await supabase
    .from('tuss_codes')
    .select('code, description')
    .in('code', codes)
  if (error) throw new Error(`fetchTussDescriptions failed: ${error.message}`)
  for (const row of (data ?? []) as unknown as Array<{ code: string; description: string }>) {
    out.set(row.code, row.description)
  }
  return out
}
