import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import {
  DENTAL_STATUS_COLUMNS,
  mapDentalStatusRow,
  type DentalStatusDTO,
  type DentalStatusScope,
} from './list'

export interface UpdateStatusInput {
  label?: string
  color?: string
  icon?: string | null
  scope?: DentalStatusScope
  /** undefined = não mexe; null = limpa; string = resolve TUSS tabela 22. */
  tussCode?: string | null
  sortOrder?: number
  isActive?: boolean
  actorUserId: string
}

async function resolveTussCodeId(
  supabase: SupabaseClient<Database>,
  tussCode: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('tuss_codes')
    .select('id, tuss_table')
    .eq('code', tussCode)
    .maybeSingle()
  if (error) throw new Error(`tuss lookup: ${error.message}`)
  if (!data) throw new ValidationError('Código TUSS não encontrado', { tussCode })
  if ((data as { tuss_table: string }).tuss_table !== '22') {
    throw new ValidationError('O código TUSS deve ser da tabela 22 (procedimentos)', { tussCode })
  }
  return (data as { id: string }).id
}

/**
 * Edita um status do catálogo. `code` e `is_system` são protegidos pelo trigger
 * `enforce_dental_status_catalog_guard` (não enviados aqui). Desativar um status
 * de sistema (ex.: `none`) é rejeitado pelo banco.
 */
export async function updateStatus(
  supabase: SupabaseClient<Database>,
  id: string,
  input: UpdateStatusInput,
): Promise<DentalStatusDTO> {
  interface StatusPatch {
    label?: string
    color?: string
    icon?: string | null
    scope?: DentalStatusScope
    sort_order?: number
    is_active?: boolean
    tuss_code_id?: string | null
    updated_by: string
  }
  const patch: StatusPatch = { updated_by: input.actorUserId }
  if (input.label !== undefined) patch.label = input.label
  if (input.color !== undefined) patch.color = input.color
  if (input.icon !== undefined) patch.icon = input.icon?.trim() || null
  if (input.scope !== undefined) patch.scope = input.scope
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder
  if (input.isActive !== undefined) patch.is_active = input.isActive
  if (input.tussCode !== undefined) {
    patch.tuss_code_id = input.tussCode ? await resolveTussCodeId(supabase, input.tussCode) : null
  }

  const { data, error } = await supabase
    .from('dental_status_catalog')
    .update(patch)
    .eq('id', id)
    .select(DENTAL_STATUS_COLUMNS)
    .maybeSingle()

  if (error) {
    if (error.code === '42501') {
      // Trigger guard: code imutável / is_system protegido.
      throw new ValidationError('Operação não permitida sobre este status (código ou status de sistema).')
    }
    if (error.code === '23514') {
      throw new ValidationError('Valores inválidos para o status (cor ou escopo).')
    }
    throw new Error(`updateStatus failed: ${error.message}`)
  }
  if (!data) throw new NotFoundError('dental_status', id)
  return mapDentalStatusRow(data)
}
