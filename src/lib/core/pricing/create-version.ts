import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { PriceVersionConflictError } from '@/lib/observability/errors'

/**
 * T108 — Cria nova versão de preço via RPC transacional
 * `create_price_version` (migration 0023). A RPC bloqueia o head com
 * SELECT … FOR UPDATE, valida `expected_head_id` e insere atomicamente.
 *
 * Lança `PriceVersionConflictError` em qualquer dos cenários de
 * conflito (chain head mudou OU UNIQUE no valid_from violado), com o
 * `current_head_id` real pra UI poder re-carregar.
 */
export interface CreatePriceVersionInput {
  tenantId: string
  procedureId: string
  planId: string
  amountCents: number
  validFrom: string
  reason: string
  expectedHeadId: string | null
  actorUserId: string
}

export interface CreatedPriceVersion {
  id: string
  tenantId: string
  procedureId: string
  planId: string
  amountCents: number
  validFrom: string
  reason: string
  createdBy: string
  previousVersionId: string | null
}

interface RpcResult {
  status: 'created' | 'conflict' | 'duplicate_valid_from'
  current_head_id?: string | null
  current_amount_cents?: number | null
  version?: {
    id: string
    tenant_id: string
    procedure_id: string
    plan_id: string
    amount_cents: number
    valid_from: string
    reason: string
    created_by: string
    previous_version_id: string | null
  }
}

export async function createPriceVersion(
  supabase: SupabaseClient<Database>,
  input: CreatePriceVersionInput,
): Promise<CreatedPriceVersion> {
  const { data, error } = await supabase.rpc('create_price_version', {
    p_tenant_id: input.tenantId,
    p_procedure_id: input.procedureId,
    p_plan_id: input.planId,
    p_amount_cents: input.amountCents,
    p_valid_from: input.validFrom,
    p_reason: input.reason,
    // The generated type marks p_expected_head_id as non-nullable, but
    // the SQL function accepts NULL (means "first version of the chain").
    p_expected_head_id: input.expectedHeadId as unknown as string,
    p_actor_id: input.actorUserId,
  })
  if (error) throw new Error(`create_price_version RPC failed: ${error.message}`)

  const result = data as unknown as RpcResult
  if (result.status === 'conflict' || result.status === 'duplicate_valid_from') {
    throw new PriceVersionConflictError(
      result.current_head_id ?? null,
      result.current_amount_cents ?? null,
    )
  }

  const v = result.version!
  return {
    id: v.id,
    tenantId: v.tenant_id,
    procedureId: v.procedure_id,
    planId: v.plan_id,
    amountCents: v.amount_cents,
    validFrom: v.valid_from,
    reason: v.reason,
    createdBy: v.created_by,
    previousVersionId: v.previous_version_id,
  }
}
