import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * T109 — Lista o head (versão vigente em `asOf`) de cada combinação
 * (procedure, plan) do tenant, com nomes joinados pra UI.
 *
 * "Head em asOf" = versão com maior `valid_from <= asOf`, tiebreaker
 * `created_at DESC`. Distinto do "head pra edição" (T108) que considera
 * a versão mais recente independentemente do valid_from.
 */
export interface PriceHead {
  id: string
  procedureId: string
  procedureTussCode: string
  planId: string
  planName: string
  amountCents: number
  validFrom: string
}

export interface ListHeadsFilter {
  tenantId: string
  procedureId?: string
  planId?: string
  asOf?: string
}

interface PriceVersionRow {
  id: string
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string
  created_at: string
  procedures: { tuss_code: string } | null
  health_plans: { name: string } | null
}

export async function listPriceHeads(
  supabase: SupabaseClient<Database>,
  filter: ListHeadsFilter,
): Promise<PriceHead[]> {
  const asOf = filter.asOf ?? new Date().toISOString().slice(0, 10)
  let q = supabase
    .from('price_versions')
    .select(
      'id, procedure_id, plan_id, amount_cents, valid_from, created_at, procedures(tuss_code), health_plans(name)',
    )
    .eq('tenant_id', filter.tenantId)
    .lte('valid_from', asOf)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
  if (filter.procedureId) q = q.eq('procedure_id', filter.procedureId)
  if (filter.planId) q = q.eq('plan_id', filter.planId)

  const { data, error } = await q
  if (error) throw new Error(`listPriceHeads failed: ${error.message}`)

  // Reduz pra um head por (procedure_id, plan_id) — a primeira ocorrência
  // após o ORDER BY já é a head desejada.
  const seen = new Set<string>()
  const heads: PriceHead[] = []
  for (const r of (data ?? []) as unknown as PriceVersionRow[]) {
    const key = `${r.procedure_id}::${r.plan_id}`
    if (seen.has(key)) continue
    seen.add(key)
    heads.push({
      id: r.id,
      procedureId: r.procedure_id,
      procedureTussCode: r.procedures?.tuss_code ?? '',
      planId: r.plan_id,
      planName: r.health_plans?.name ?? '',
      amountCents: r.amount_cents,
      validFrom: r.valid_from,
    })
  }
  return heads
}
