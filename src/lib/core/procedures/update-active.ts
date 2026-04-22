import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * T162 — Atualiza apenas `display_name` e/ou `active` (RLS gate
 * `procedures_admin_update` exige role admin).
 */
export interface UpdateProcedureInput {
  tenantId: string
  procedureId: string
  patch: {
    displayName?: string | null
    active?: boolean
    defaultAmountCents?: number | null
    coveredByPlan?: boolean
  }
}

export async function updateProcedure(
  supabase: SupabaseClient<Database>,
  input: UpdateProcedureInput,
): Promise<{
  id: string
  displayName: string | null
  active: boolean
  defaultAmountCents: number | null
  coveredByPlan: boolean
}> {
  const updates: {
    display_name?: string | null
    active?: boolean
    default_amount_cents?: number | null
    covered_by_plan?: boolean
  } = {}
  if ('displayName' in input.patch) updates.display_name = input.patch.displayName ?? null
  if ('active' in input.patch && typeof input.patch.active === 'boolean') {
    updates.active = input.patch.active
  }
  if ('defaultAmountCents' in input.patch) {
    updates.default_amount_cents = input.patch.defaultAmountCents ?? null
  }
  if ('coveredByPlan' in input.patch && typeof input.patch.coveredByPlan === 'boolean') {
    updates.covered_by_plan = input.patch.coveredByPlan
  }
  if (Object.keys(updates).length === 0) {
    throw new Error('updateProcedure: nothing to update')
  }

  const { data, error } = await supabase
    .from('procedures')
    .update(updates)
    .eq('id', input.procedureId)
    .eq('tenant_id', input.tenantId)
    .select('id, display_name, active, default_amount_cents, covered_by_plan')
    .maybeSingle()
  if (error) throw new Error(`updateProcedure failed: ${error.message}`)
  if (!data) throw new NotFoundError('procedure', input.procedureId)

  return {
    id: data.id,
    displayName: data.display_name,
    active: data.active,
    defaultAmountCents: data.default_amount_cents,
    coveredByPlan: data.covered_by_plan,
  }
}
