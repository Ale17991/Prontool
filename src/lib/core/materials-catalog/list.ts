import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { mapMaterialRow, type MaterialRow } from './create'

/**
 * Feature 045 — lista insumos do catálogo. Ativos por padrão (para o
 * seletor do atendimento); `includeInactive` para a tela de gestão.
 */
export interface ListMaterialsInput {
  tenantId: string
  includeInactive?: boolean
}

export async function listMaterials(
  supabase: SupabaseClient<Database>,
  input: ListMaterialsInput,
): Promise<MaterialRow[]> {
  let query = supabase
    .from('tenant_materials' as never)
    .select('id, name, unit_cost_cents, tuss_code, active, updated_at')
    .eq('tenant_id', input.tenantId)
    .order('name', { ascending: true })

  if (!input.includeInactive) {
    query = query.eq('active', true)
  }

  const { data, error } = await query
  if (error) {
    // Migration 0172 ainda não aplicada → catálogo vazio (UI não renderiza).
    if (/relation .*tenant_materials.* does not exist/i.test(error.message)) return []
    throw new Error(`listMaterials failed: ${error.message}`)
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapMaterialRow)
}
