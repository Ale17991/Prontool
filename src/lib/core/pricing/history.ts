import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * T110 — Retorna a chain completa de versões de preço para a mesma
 * combinação (procedure, plan) à qual pertence a versão `versionId`.
 * Ordenada por `valid_from DESC, created_at DESC` (mesma ordem usada
 * pela view de vigência em 0006).
 */
export interface PriceVersionRow {
  id: string
  procedureId: string
  planId: string
  amountCents: number
  validFrom: string
  createdAt: string
  createdBy: string
  reason: string
  previousVersionId: string | null
}

export async function getPriceHistory(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; versionId: string },
): Promise<PriceVersionRow[]> {
  const seed = await supabase
    .from('price_versions')
    .select('procedure_id, plan_id')
    .eq('id', args.versionId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()
  if (seed.error) throw new Error(`history seed lookup failed: ${seed.error.message}`)
  if (!seed.data) throw new NotFoundError('price_version', args.versionId)

  const chain = await supabase
    .from('price_versions')
    .select('id, procedure_id, plan_id, amount_cents, valid_from, created_at, created_by, reason, previous_version_id')
    .eq('tenant_id', args.tenantId)
    .eq('procedure_id', seed.data.procedure_id)
    .eq('plan_id', seed.data.plan_id)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
  if (chain.error) throw new Error(`history chain query failed: ${chain.error.message}`)

  return (chain.data ?? []).map((r) => ({
    id: r.id,
    procedureId: r.procedure_id,
    planId: r.plan_id,
    amountCents: r.amount_cents,
    validFrom: r.valid_from,
    createdAt: r.created_at,
    createdBy: r.created_by,
    reason: r.reason,
    previousVersionId: r.previous_version_id,
  }))
}
