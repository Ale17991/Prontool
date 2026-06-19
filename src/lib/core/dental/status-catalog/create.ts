import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, ValidationError } from '@/lib/observability/errors'
import {
  DENTAL_STATUS_COLUMNS,
  mapDentalStatusRow,
  type DentalStatusDTO,
  type DentalStatusScope,
} from './list'

export interface CreateStatusInput {
  code: string
  label: string
  color: string
  icon?: string | null
  scope: DentalStatusScope
  /** Código TUSS (tabela 22) opcional — resolvido para tuss_code_id. */
  tussCode?: string | null
  sortOrder?: number
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

export async function createStatus(
  supabase: SupabaseClient<Database>,
  input: CreateStatusInput,
): Promise<DentalStatusDTO> {
  const tussCodeId = input.tussCode ? await resolveTussCodeId(supabase, input.tussCode) : null

  const { data, error } = await supabase
    .from('dental_status_catalog')
    .insert({
      code: input.code,
      label: input.label,
      color: input.color,
      icon: input.icon?.trim() || null,
      scope: input.scope,
      tuss_code_id: tussCodeId,
      sort_order: input.sortOrder ?? 0,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select(DENTAL_STATUS_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ConflictError('DENTAL_STATUS_DUPLICATE', `Já existe um status com o código "${input.code}".`)
    }
    if (error.code === '23514') {
      throw new ValidationError('Valores inválidos para o status (código, cor ou escopo).')
    }
    throw new Error(`createStatus failed: ${error.message}`)
  }
  return mapDentalStatusRow(data)
}
