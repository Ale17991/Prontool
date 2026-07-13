import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError } from '@/lib/observability/errors'
import { assertCost, assertName, mapMaterialRow, type MaterialRow } from './create'

/**
 * Feature 045 — edita um insumo do catálogo (nome, custo, situação).
 * Não altera custos já congelados em atendimentos passados (o snapshot vive
 * em appointment_materials). Toda mudança é auditada pelo trigger da tabela.
 */
export interface UpdateMaterialInput {
  tenantId: string
  id: string
  name?: string
  unitCostCents?: number
  active?: boolean
  actorUserId: string
}

export async function updateMaterial(
  supabase: SupabaseClient<Database>,
  input: UpdateMaterialInput,
): Promise<MaterialRow> {
  const patch: Record<string, unknown> = { updated_by: input.actorUserId }
  if (input.name !== undefined) patch.name = assertName(input.name)
  if (input.unitCostCents !== undefined) {
    assertCost(input.unitCostCents)
    patch.unit_cost_cents = input.unitCostCents
  }
  if (input.active !== undefined) patch.active = input.active

  const { data, error } = await supabase
    .from('tenant_materials' as never)
    .update(patch as never)
    .eq('id', input.id)
    .eq('tenant_id', input.tenantId)
    .select('id, name, unit_cost_cents, tuss_code, active, updated_at')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      throw new ConflictError('MATERIAL_DUPLICATE', 'Já existe um insumo ativo com esse nome.')
    }
    throw new Error(`updateMaterial failed: ${error.message}`)
  }
  if (!data) throw new NotFoundError('tenant_materials', input.id)
  return mapMaterialRow(data as unknown as Record<string, unknown>)
}
