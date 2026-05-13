import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { bpsValid } from '@/lib/validation/rate-bps'
import type { TaxRow } from './create'

/**
 * T023 — Feature 011 — atualiza colunas mutáveis de um imposto.
 *
 * Mutáveis: rate_bps, description, is_active.
 * Imutáveis (bloqueadas por trigger no DB): name, category, tenant_id, etc.
 *
 * Soft-delete reversível via is_active. Não há DELETE físico (trigger
 * `taxes_no_physical_delete` reusa `enforce_append_only`).
 */
export interface UpdateTaxInput {
  tenantId: string
  id: string
  rateBps?: number
  description?: string | null
  isActive?: boolean
}

export async function updateTax(
  supabase: SupabaseClient<Database>,
  input: UpdateTaxInput,
): Promise<TaxRow> {
  const patch: Record<string, unknown> = {}
  if (input.rateBps !== undefined) {
    if (!bpsValid(input.rateBps)) {
      throw new ValidationError('Alíquota inválida: deve ser inteiro entre 0 e 10000 bps.')
    }
    patch.rate_bps = input.rateBps
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null
  }
  if (input.isActive !== undefined) {
    patch.is_active = input.isActive
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Nenhum campo informado para atualização.')
  }

  const { data, error } = await supabase
    .from('taxes' as never)
    .update(patch as never)
    .eq('id', input.id)
    .eq('tenant_id', input.tenantId)
    .select(
      'id, tenant_id, name, rate_bps, description, category, is_active, created_at, created_by, deleted_at, deleted_by',
    )
    .maybeSingle()

  if (error) throw new Error(`updateTax failed: ${error.message}`)
  if (!data) throw new NotFoundError('tax', input.id)
  return data as unknown as TaxRow
}
