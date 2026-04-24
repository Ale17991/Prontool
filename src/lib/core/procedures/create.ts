import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, TussCodeInvalidError } from '@/lib/observability/errors'

/**
 * T162 — Cria procedimento. A validação de TUSS (existe + valid_to IS NULL)
 * roda no trigger BEFORE INSERT (migration 0014). Aqui mapeamos:
 *   - 23505 (unique tenant+tuss) → ConflictError
 *   - mensagem do trigger TUSS → TussCodeInvalidError (400)
 */
export interface CreateProcedureInput {
  tenantId: string
  tussCode: string
  displayName?: string | null
  /** Valor particular raiz em centavos. null = sem valor particular definido. */
  defaultAmountCents?: number | null
  /** false = procedimento é sempre particular (não aparece em tabelas por convênio). */
  coveredByPlan?: boolean
}

export interface ProcedureRow {
  id: string
  tussCode: string
  displayName: string | null
  active: boolean
  createdAt: string
  defaultAmountCents: number | null
  coveredByPlan: boolean
}

export async function createProcedure(
  supabase: SupabaseClient<Database>,
  input: CreateProcedureInput,
): Promise<ProcedureRow> {
  const { data, error } = await supabase
    .from('procedures')
    .insert({
      tenant_id: input.tenantId,
      tuss_code: input.tussCode,
      display_name: input.displayName ?? null,
      default_amount_cents: input.defaultAmountCents ?? null,
      covered_by_plan: input.coveredByPlan ?? true,
    })
    .select('id, tuss_code, display_name, active, created_at, default_amount_cents, covered_by_plan')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ConflictError('PROCEDURE_DUPLICATE', `Procedure with TUSS ${input.tussCode} already exists in tenant`, {
        tuss_code: input.tussCode,
      })
    }
    if (/tuss/i.test(error.message)) {
      throw new TussCodeInvalidError(input.tussCode, error.message)
    }
    throw new Error(`createProcedure failed: ${error.message}`)
  }
  return {
    id: data.id,
    tussCode: data.tuss_code,
    displayName: data.display_name,
    active: data.active,
    createdAt: data.created_at,
    defaultAmountCents: data.default_amount_cents,
    coveredByPlan: data.covered_by_plan,
  }
}
