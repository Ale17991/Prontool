import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 047 — grupos alimentares e listas de substituição/equivalentes.
 * Leitura (US1/US3). A escrita das listas próprias da clínica é T036 (US3).
 */

export interface FoodGroupDTO {
  slug: string
  label: string
  displayOrder: number
}

export interface EquivalenceItemDTO {
  foodId: string
  name: string
  grams: number
}

export interface EquivalenceListDTO {
  id: string
  groupSlug: string | null
  name: string
  referenceKcal: number | null
  isCustom: boolean
  items: EquivalenceItemDTO[]
}

export async function listFoodGroups(
  supabase: SupabaseClient<Database>,
): Promise<FoodGroupDTO[]> {
  const { data, error } = await supabase
    .from('food_groups')
    .select('slug, label, display_order')
    .eq('active', true)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`listFoodGroups failed: ${error.message}`)
  return ((data ?? []) as Array<{ slug: string; label: string; display_order: number }>).map((g) => ({
    slug: g.slug,
    label: g.label,
    displayOrder: g.display_order,
  }))
}

/** Listas visíveis à clínica: globais (tenant_id NULL) + as próprias. */
export async function listEquivalenceLists(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<EquivalenceListDTO[]> {
  const { data: lists, error } = await supabase
    .from('food_equivalence_lists')
    .select('id, tenant_id, name, reference_kcal, group_id, food_groups(slug)')
    .eq('active', true)
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
  if (error) throw new Error(`listEquivalenceLists failed: ${error.message}`)
  const rows = (lists ?? []) as Array<{
    id: string
    tenant_id: string | null
    name: string
    reference_kcal: number | null
    food_groups: { slug: string } | null
  }>
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const { data: items, error: iErr } = await supabase
    .from('food_equivalence_items')
    .select('list_id, grams, foods(id, name)')
    .in('list_id', ids)
  if (iErr) throw new Error(`listEquivalenceLists items failed: ${iErr.message}`)

  const byList = new Map<string, EquivalenceItemDTO[]>()
  for (const it of (items ?? []) as Array<{
    list_id: string
    grams: number
    foods: { id: string; name: string } | null
  }>) {
    if (!it.foods) continue
    const arr = byList.get(it.list_id) ?? []
    arr.push({ foodId: it.foods.id, name: it.foods.name, grams: Number(it.grams) })
    byList.set(it.list_id, arr)
  }

  return rows.map((r) => ({
    id: r.id,
    groupSlug: r.food_groups?.slug ?? null,
    name: r.name,
    referenceKcal: r.reference_kcal === null ? null : Number(r.reference_kcal),
    isCustom: r.tenant_id !== null,
    items: byList.get(r.id) ?? [],
  }))
}
