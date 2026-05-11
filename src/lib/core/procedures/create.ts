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
  /** null somente quando isUnlisted=true (migration 0066). */
  tussCode: string | null
  displayName?: string | null
  /** Valor particular raiz em centavos. null = sem valor particular definido. */
  defaultAmountCents?: number | null
  /** false = procedimento é sempre particular (não aparece em tabelas por convênio). */
  coveredByPlan?: boolean
  /**
   * true = procedimento local sem código TUSS. Migration 0066 exige
   * tussCode=null + displayName preenchido + coveredByPlan=false.
   */
  isUnlisted?: boolean
}

export interface ProcedureRow {
  id: string
  tussCode: string | null
  displayName: string | null
  active: boolean
  createdAt: string
  defaultAmountCents: number | null
  coveredByPlan: boolean
  isUnlisted: boolean
}

export async function createProcedure(
  supabase: SupabaseClient<Database>,
  input: CreateProcedureInput,
): Promise<ProcedureRow> {
  const isUnlisted = input.isUnlisted ?? false
  // Migration 0066 garante isso via CHECK constraint, mas validamos cedo
  // para devolver erro de domínio mais claro do que "check constraint failed".
  if (isUnlisted) {
    if (input.tussCode !== null && input.tussCode !== undefined) {
      throw new Error('createProcedure: tussCode must be null when isUnlisted=true')
    }
    if (!input.displayName || input.displayName.trim().length === 0) {
      throw new Error('createProcedure: displayName is required when isUnlisted=true')
    }
  } else if (!input.tussCode) {
    throw new Error('createProcedure: tussCode is required when isUnlisted=false')
  }

  const { data, error } = await supabase
    .from('procedures')
    .insert({
      tenant_id: input.tenantId,
      tuss_code: input.tussCode,
      display_name: input.displayName ?? null,
      default_amount_cents: input.defaultAmountCents ?? null,
      covered_by_plan: isUnlisted ? false : input.coveredByPlan ?? true,
      is_unlisted: isUnlisted,
    })
    .select('id, tuss_code, display_name, active, created_at, default_amount_cents, covered_by_plan, is_unlisted')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ConflictError('PROCEDURE_DUPLICATE', `Procedure with TUSS ${input.tussCode} already exists in tenant`, {
        tuss_code: input.tussCode,
      })
    }
    if (/tuss/i.test(error.message)) {
      // Quando isUnlisted=true o trigger TUSS pula a validação (migration
      // 0066), então este branch só dispara com tussCode preenchido.
      throw new TussCodeInvalidError(input.tussCode ?? '(unlisted)', error.message)
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
    isUnlisted: data.is_unlisted,
  }
}
