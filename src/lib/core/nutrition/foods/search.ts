import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 047 — busca de alimentos (catálogo global + próprios da clínica).
 * Delega à RPC `search_foods` (migration 0177), que usa o índice trigram
 * acento-insensível. Escopo por `tenantId` (global + custom OU só custom).
 */

export interface FoodMeasureDTO {
  label: string
  grams: number
  isDefault: boolean
}

export interface FoodDTO {
  id: string
  name: string
  source: string
  isCustom: boolean
  groupSlug: string | null
  groupLabel: string | null
  referenceGrams: number
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number | null
  measures: FoodMeasureDTO[]
}

interface RpcRow {
  id: string
  tenant_id: string | null
  source: string
  name: string
  group_slug: string | null
  group_label: string | null
  reference_grams: number
  energy_kcal: number
  protein_g: number
  carb_g: number
  fat_g: number
  fiber_g: number | null
}

export interface SearchFoodsArgs {
  tenantId: string
  query?: string
  group?: string
  scope?: 'all' | 'custom'
  limit?: number
}

export async function searchFoods(
  supabase: SupabaseClient<Database>,
  args: SearchFoodsArgs,
): Promise<FoodDTO[]> {
  const { data, error } = await supabase.rpc('search_foods', {
    p_tenant_id: args.tenantId,
    p_query: args.query?.trim() || null,
    p_group: args.group || null,
    p_scope: args.scope ?? 'all',
    p_limit: args.limit ?? 20,
  } as never)
  if (error) throw new Error(`searchFoods failed: ${error.message}`)
  const rows = (data ?? []) as unknown as RpcRow[]
  if (rows.length === 0) return []

  // Medidas caseiras num único fetch (visíveis por RLS/escopo do serviço).
  const ids = rows.map((r) => r.id)
  const { data: measData, error: measErr } = await supabase
    .from('food_household_measures')
    .select('food_id, label, grams, is_default')
    .in('food_id', ids)
  if (measErr) throw new Error(`searchFoods measures failed: ${measErr.message}`)

  const byFood = new Map<string, FoodMeasureDTO[]>()
  for (const m of (measData ?? []) as Array<{
    food_id: string
    label: string
    grams: number
    is_default: boolean
  }>) {
    const list = byFood.get(m.food_id) ?? []
    list.push({ label: m.label, grams: Number(m.grams), isDefault: m.is_default })
    byFood.set(m.food_id, list)
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    source: r.source,
    isCustom: r.tenant_id !== null,
    groupSlug: r.group_slug,
    groupLabel: r.group_label,
    referenceGrams: Number(r.reference_grams),
    energyKcal: Number(r.energy_kcal),
    proteinG: Number(r.protein_g),
    carbG: Number(r.carb_g),
    fatG: Number(r.fat_g),
    fiberG: r.fiber_g === null ? null : Number(r.fiber_g),
    measures: (byFood.get(r.id) ?? []).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
  }))
}
