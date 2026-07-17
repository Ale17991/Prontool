import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, ValidationError } from '@/lib/observability/errors'

/**
 * Feature 045 — catálogo de insumos por clínica (tenant_materials).
 *
 * Insumo LIVRE (não restrito a TUSS). `tussCode` é opcional; se presente, o
 * trigger `check_tenant_material_tuss` valida tabela 19 vigente. Nome único
 * (case-insensitive) entre os insumos ATIVOS do tenant. Custo em centavos.
 */
export interface MaterialRow {
  id: string
  name: string
  unitCostCents: number
  tussCode: string | null
  active: boolean
  updatedAt: string | null
}

export interface CreateMaterialInput {
  tenantId: string
  name: string
  unitCostCents: number
  tussCode?: string | null
  actorUserId: string
}

export function mapMaterialRow(r: Record<string, unknown>): MaterialRow {
  return {
    id: r.id as string,
    name: r.name as string,
    unitCostCents: r.unit_cost_cents as number,
    tussCode: (r.tuss_code as string | null) ?? null,
    active: r.active as boolean,
    updatedAt: (r.updated_at as string | null) ?? null,
  }
}

function assertName(name: string): string {
  const n = name.trim()
  if (n.length < 1 || n.length > 200) {
    throw new ValidationError('Nome do insumo deve ter entre 1 e 200 caracteres.')
  }
  return n
}

function assertCost(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new ValidationError('Custo unitário deve ser um inteiro ≥ 0 (centavos).')
  }
}

export async function createMaterial(
  supabase: SupabaseClient<Database>,
  input: CreateMaterialInput,
): Promise<MaterialRow> {
  const name = assertName(input.name)
  assertCost(input.unitCostCents)

  const { data, error } = await supabase
    .from('tenant_materials' as never)
    .insert({
      tenant_id: input.tenantId,
      name,
      unit_cost_cents: input.unitCostCents,
      tuss_code: input.tussCode?.trim() || null,
      created_by: input.actorUserId,
    } as never)
    .select('id, name, unit_cost_cents, tuss_code, active, updated_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ConflictError('MATERIAL_DUPLICATE', `Já existe um insumo ativo com o nome "${name}".`, {
        name,
      })
    }
    if (/MATERIAL_TUSS_INVALID/.test(error.message)) {
      throw new ValidationError('Código TUSS inválido ou fora da tabela de materiais (19).')
    }
    throw new Error(`createMaterial failed: ${error.message}`)
  }
  return mapMaterialRow(data as unknown as Record<string, unknown>)
}

export { assertName, assertCost }
