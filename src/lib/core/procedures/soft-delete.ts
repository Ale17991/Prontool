import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * Soft delete: marca o procedimento como removido (deleted_at = now()).
 * Históricos referenciados (appointments, price_versions, treatment
 * plan steps) permanecem intactos — apenas some das listagens de selecao.
 */
export interface SoftDeleteProcedureInput {
  tenantId: string
  procedureId: string
  actorUserId: string
}

export interface SoftDeleteProcedureResult {
  id: string
  deletedAt: string
}

export async function softDeleteProcedure(
  supabase: SupabaseClient<Database>,
  input: SoftDeleteProcedureInput,
): Promise<SoftDeleteProcedureResult> {
  // Pre-check de tenant — garantia mesmo sob service-role.
  const lookup = await supabase
    .from('procedures')
    .select('id, deleted_at')
    .eq('id', input.procedureId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (lookup.error) {
    throw new Error(`procedure lookup failed: ${lookup.error.message}`)
  }
  if (!lookup.data) {
    throw new NotFoundError('procedures', input.procedureId)
  }
  const lookupRow = lookup.data as { id: string; deleted_at: string | null }
  if (lookupRow.deleted_at !== null) {
    return { id: lookupRow.id, deletedAt: lookupRow.deleted_at }
  }

  const nowIso = new Date().toISOString()
  const updated = await supabase
    .from('procedures')
    .update({ deleted_at: nowIso, deleted_by: input.actorUserId } as never)
    .eq('id', input.procedureId)
    .eq('tenant_id', input.tenantId)
    .select('id, deleted_at')
    .single()
  if (updated.error || !updated.data) {
    throw new Error(`softDeleteProcedure failed: ${updated.error?.message ?? 'empty response'}`)
  }
  const row = updated.data as unknown as { id: string; deleted_at: string }
  return { id: row.id, deletedAt: row.deleted_at }
}
