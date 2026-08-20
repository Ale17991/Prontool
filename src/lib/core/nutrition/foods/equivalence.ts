import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'
import { groupNutrients, type Nutrients, type PlanItemInput } from '../diet/totals'

/**
 * Feature 047 — grupos alimentares e listas de substituição/equivalentes.
 * Leitura (US1) + escrita das listas próprias da clínica (US3).
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
  /** Nutrientes de "1 porção" do grupo — energia = referenceKcal, macros
   * proporcionais à composição média dos itens (ver `groupNutrients`). */
  nutrients: Nutrients
}

export async function listFoodGroups(supabase: SupabaseClient<Database>): Promise<FoodGroupDTO[]> {
  const { data, error } = await supabase
    .from('food_groups')
    .select('slug, label, display_order')
    .eq('active', true)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`listFoodGroups failed: ${error.message}`)
  return ((data ?? []) as Array<{ slug: string; label: string; display_order: number }>).map(
    (g) => ({
      slug: g.slug,
      label: g.label,
      displayOrder: g.display_order,
    }),
  )
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
    .select(
      'list_id, grams, foods(id, name, reference_grams, energy_kcal, protein_g, carb_g, fat_g, fiber_g)',
    )
    .in('list_id', ids)
  if (iErr) throw new Error(`listEquivalenceLists items failed: ${iErr.message}`)

  const byList = new Map<string, EquivalenceItemDTO[]>()
  // Itens resolvidos p/ o cálculo dos nutrientes representativos do grupo.
  const calcByList = new Map<string, PlanItemInput[]>()
  for (const it of (items ?? []) as Array<{
    list_id: string
    grams: number
    foods: {
      id: string
      name: string
      reference_grams: number
      energy_kcal: number
      protein_g: number
      carb_g: number
      fat_g: number
      fiber_g: number | null
    } | null
  }>) {
    if (!it.foods) continue
    const grams = Number(it.grams)
    const arr = byList.get(it.list_id) ?? []
    arr.push({ foodId: it.foods.id, name: it.foods.name, grams })
    byList.set(it.list_id, arr)

    const calc = calcByList.get(it.list_id) ?? []
    calc.push({
      grams,
      food: {
        referenceGrams: Number(it.foods.reference_grams),
        energyKcal: Number(it.foods.energy_kcal),
        proteinG: Number(it.foods.protein_g),
        carbG: Number(it.foods.carb_g),
        fatG: Number(it.foods.fat_g),
        fiberG: it.foods.fiber_g === null ? null : Number(it.foods.fiber_g),
      },
    })
    calcByList.set(it.list_id, calc)
  }

  return rows.map((r) => {
    const referenceKcal = r.reference_kcal === null ? null : Number(r.reference_kcal)
    return {
      id: r.id,
      groupSlug: r.food_groups?.slug ?? null,
      name: r.name,
      referenceKcal,
      isCustom: r.tenant_id !== null,
      items: byList.get(r.id) ?? [],
      nutrients: groupNutrients({ referenceKcal, items: calcByList.get(r.id) ?? [] }),
    }
  })
}

// =========================================================================
// Escrita — listas de substituição próprias da clínica (US3, FR-015)
// =========================================================================

export interface EquivalenceItemInput {
  foodId: string
  grams: number
}
export interface SaveEquivalenceListInput {
  tenantId: string
  groupSlug: string
  name: string
  referenceKcal?: number | null
  items: EquivalenceItemInput[]
}

async function groupIdBySlug(supabase: SupabaseClient<Database>, slug: string): Promise<string> {
  const { data } = await supabase.from('food_groups').select('id').eq('slug', slug).maybeSingle()
  const id = (data as { id: string } | null)?.id
  if (!id) throw new DomainError('INVALID_GROUP', 'Grupo alimentar inválido.', { status: 422 })
  return id
}

/** Valida que os alimentos são visíveis à clínica (globais ou próprios). */
async function assertFoodsVisible(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  foodIds: string[],
): Promise<void> {
  if (foodIds.length === 0) return
  const { data } = await supabase.from('foods').select('id, tenant_id').in('id', foodIds)
  const rows = (data ?? []) as Array<{ id: string; tenant_id: string | null }>
  const ok = new Set(
    rows.filter((r) => r.tenant_id === null || r.tenant_id === tenantId).map((r) => r.id),
  )
  for (const id of foodIds) {
    if (!ok.has(id))
      throw new DomainError('FOOD_NOT_VISIBLE', 'Alimento indisponível.', { status: 422 })
  }
}

export async function createEquivalenceList(
  supabase: SupabaseClient<Database>,
  input: SaveEquivalenceListInput,
): Promise<{ id: string }> {
  const name = input.name.trim()
  if (name.length < 1 || name.length > 120) {
    throw new DomainError('INVALID_LIST', 'Nome da lista inválido (1 a 120 caracteres).', {
      status: 422,
    })
  }
  const groupId = await groupIdBySlug(supabase, input.groupSlug)
  await assertFoodsVisible(
    supabase,
    input.tenantId,
    input.items.map((i) => i.foodId),
  )

  const { data, error } = await supabase
    .from('food_equivalence_lists')
    .insert({
      tenant_id: input.tenantId,
      group_id: groupId,
      name,
      reference_kcal: input.referenceKcal ?? null,
    } as never)
    .select('id')
    .single()
  if (error || !data) throw new Error(`createEquivalenceList: ${error?.message}`)
  const listId = (data as { id: string }).id

  const items = input.items.filter((i) => i.grams > 0)
  if (items.length > 0) {
    const { error: iErr } = await supabase.from('food_equivalence_items').insert(
      items.map((i) => ({
        list_id: listId,
        tenant_id: input.tenantId,
        food_id: i.foodId,
        grams: i.grams,
      })) as never,
    )
    if (iErr) throw new Error(`createEquivalenceList items: ${iErr.message}`)
  }
  return { id: listId }
}

/** Substitui a lista inteira (nome, meta e itens) — só listas PRÓPRIAS. */
export async function updateEquivalenceList(
  supabase: SupabaseClient<Database>,
  input: SaveEquivalenceListInput & { listId: string },
): Promise<void> {
  const existing = await supabase
    .from('food_equivalence_lists')
    .select('tenant_id')
    .eq('id', input.listId)
    .maybeSingle()
  const row = existing.data as { tenant_id: string | null } | null
  if (!row) throw new NotFoundError('equivalence_list', input.listId)
  if (row.tenant_id !== input.tenantId) {
    throw new DomainError('LIST_NOT_EDITABLE', 'Lista não editável.', { status: 403 })
  }
  const groupId = await groupIdBySlug(supabase, input.groupSlug)
  await assertFoodsVisible(
    supabase,
    input.tenantId,
    input.items.map((i) => i.foodId),
  )

  const upd = await supabase
    .from('food_equivalence_lists')
    .update({
      name: input.name.trim(),
      reference_kcal: input.referenceKcal ?? null,
      group_id: groupId,
    } as never)
    .eq('id', input.listId)
    .eq('tenant_id', input.tenantId)
  if (upd.error) throw new Error(`updateEquivalenceList: ${upd.error.message}`)

  await supabase
    .from('food_equivalence_items')
    .delete()
    .eq('list_id', input.listId)
    .eq('tenant_id', input.tenantId)
  const items = input.items.filter((i) => i.grams > 0)
  if (items.length > 0) {
    const { error } = await supabase.from('food_equivalence_items').insert(
      items.map((i) => ({
        list_id: input.listId,
        tenant_id: input.tenantId,
        food_id: i.foodId,
        grams: i.grams,
      })) as never,
    )
    if (error) throw new Error(`updateEquivalenceList items: ${error.message}`)
  }
}

export async function deleteEquivalenceList(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; listId: string },
): Promise<void> {
  const { data, error } = await supabase
    .from('food_equivalence_lists')
    .delete()
    .eq('id', args.listId)
    .eq('tenant_id', args.tenantId)
    .select('id')
  if (error) throw new Error(`deleteEquivalenceList: ${error.message}`)
  if (!data || (data as unknown[]).length === 0) {
    throw new DomainError('LIST_NOT_EDITABLE', 'Lista não encontrada ou não editável.', {
      status: 404,
    })
  }
}
