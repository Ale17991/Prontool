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
   * tussCode=null + displayName preenchido. coveredByPlan é independente
   * (migration 0067) — pacotes negociados com convênio podem ser
   * unlisted + covered.
   */
  isUnlisted?: boolean
  /**
   * FK para custom_procedure_codes (migration 0073). Quando preenchido,
   * exige isUnlisted=true. Codigos personalizados sao do dominio unlisted;
   * procedimentos TUSS-coded usam o tuss_code.
   */
  customCodeId?: string | null
  /**
   * FK para custom_procedure_tables (migration 0075). Quando preenchido,
   * exige isUnlisted=true. Agrupa o procedimento em uma "tabela pessoal"
   * da clinica.
   */
  customTableId?: string | null
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
  customCodeId: string | null
  customTableId: string | null
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

  const customCodeId = input.customCodeId ?? null
  const customTableId = input.customTableId ?? null
  if (customCodeId !== null && !isUnlisted) {
    throw new Error('createProcedure: customCodeId requer isUnlisted=true')
  }
  if (customTableId !== null && !isUnlisted) {
    throw new Error('createProcedure: customTableId requer isUnlisted=true')
  }

  // Auto-preenche display_name a partir do catálogo TUSS quando vazio
  // e o procedimento é TUSS-listado (tuss_code preenchido). Evita o caso
  // de procedimentos cadastrados sem rótulo de exibição.
  let resolvedDisplayName: string | null = input.displayName?.trim() || null
  if (!resolvedDisplayName && !isUnlisted && input.tussCode) {
    const { data: tussRow, error: tussErr } = await supabase
      .from('tuss_codes')
      .select('description')
      .eq('code', input.tussCode)
      .maybeSingle()
    if (tussErr) {
      throw new Error(`createProcedure tuss_codes lookup failed: ${tussErr.message}`)
    }
    const desc = (tussRow as { description?: string | null } | null)?.description?.trim()
    if (desc && desc.length > 0) {
      resolvedDisplayName = desc
    }
  }

  const { data, error } = await supabase
    .from('procedures')
    .insert({
      tenant_id: input.tenantId,
      tuss_code: input.tussCode,
      display_name: resolvedDisplayName,
      default_amount_cents: input.defaultAmountCents ?? null,
      covered_by_plan: input.coveredByPlan ?? true,
      is_unlisted: isUnlisted,
      custom_code_id: customCodeId,
      custom_table_id: customTableId,
    } as never)
    .select(
      'id, tuss_code, display_name, active, created_at, default_amount_cents, covered_by_plan, is_unlisted, custom_code_id, custom_table_id',
    )
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
  const row = data as unknown as {
    id: string
    tuss_code: string | null
    display_name: string | null
    active: boolean
    created_at: string
    default_amount_cents: number | null
    covered_by_plan: boolean
    is_unlisted: boolean
    custom_code_id: string | null
    custom_table_id: string | null
  }
  return {
    id: row.id,
    tussCode: row.tuss_code,
    displayName: row.display_name,
    active: row.active,
    createdAt: row.created_at,
    defaultAmountCents: row.default_amount_cents,
    coveredByPlan: row.covered_by_plan,
    isUnlisted: row.is_unlisted,
    customCodeId: row.custom_code_id,
    customTableId: row.custom_table_id,
  }
}
