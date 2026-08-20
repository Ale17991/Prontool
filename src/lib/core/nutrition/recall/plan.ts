import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  itemNutrients,
  addNutrients,
  roundNutrients,
  type FoodRef,
  type Nutrients,
} from '../diet/totals'

/**
 * Feature 049 US3 — recordatório alimentar R24h (consumo real de um dia).
 * Reusa a base de alimentos e o motor de soma (energia+macros+micros). Editável;
 * sem prescrição/imutabilidade. Um recordatório por (paciente, data).
 */

function loose(sb: SupabaseClient<Database>): SupabaseClient {
  return sb as unknown as SupabaseClient
}

export interface RecallItemInputDTO {
  foodId: string
  grams?: number | null
  measureLabel?: string | null
  measureQty?: number | null
}
export interface RecallMealInputDTO {
  name: string
  position: number
  items: RecallItemInputDTO[]
}
export interface SaveRecallArgs {
  tenantId: string
  patientId: string
  actorUserId: string
  recallDate: string
  notes?: string | null
  meals: RecallMealInputDTO[]
}

export interface RecallItemView {
  foodId: string
  name: string
  grams: number | null
  measureLabel: string | null
  measureQty: number | null
  nutrients: Nutrients | null
}
export interface RecallMealView {
  name: string
  items: RecallItemView[]
  totals: Nutrients
}
export interface RecallView {
  id: string
  recallDate: string
  notes: string | null
  meals: RecallMealView[]
  totals: Nutrients
}
export interface RecallSummary {
  id: string
  recallDate: string
  totalKcal: number
}

async function loadFoodRefs(
  sb: SupabaseClient<Database>,
  foodIds: string[],
): Promise<Map<string, FoodRef & { name: string }>> {
  const map = new Map<string, FoodRef & { name: string }>()
  if (foodIds.length === 0) return map
  const { data, error } = await sb
    .from('foods')
    .select(
      'id, name, reference_grams, energy_kcal, protein_g, carb_g, fat_g, fiber_g, micronutrients',
    )
    .in('id', foodIds)
  if (error) throw new Error(`recall loadFoodRefs: ${error.message}`)
  for (const f of (data ?? []) as unknown as Array<{
    id: string
    name: string
    reference_grams: number
    energy_kcal: number
    protein_g: number
    carb_g: number
    fat_g: number
    fiber_g: number | null
    micronutrients: Record<string, number> | null
  }>) {
    map.set(f.id, {
      name: f.name,
      referenceGrams: Number(f.reference_grams),
      energyKcal: Number(f.energy_kcal),
      proteinG: Number(f.protein_g),
      carbG: Number(f.carb_g),
      fatG: Number(f.fat_g),
      fiberG: f.fiber_g === null ? null : Number(f.fiber_g),
      micros: f.micronutrients ?? null,
    })
  }
  return map
}

async function resolveGrams(
  sb: SupabaseClient<Database>,
  it: RecallItemInputDTO,
): Promise<number | null> {
  if (typeof it.grams === 'number' && it.grams > 0) return it.grams
  if (it.foodId && it.measureLabel && typeof it.measureQty === 'number' && it.measureQty > 0) {
    const { data } = await loose(sb)
      .from('food_household_measures')
      .select('grams')
      .eq('food_id', it.foodId)
      .eq('label', it.measureLabel)
      .limit(1)
      .maybeSingle()
    const g = (data as { grams: number } | null)?.grams
    if (g) return Number(g) * it.measureQty
  }
  return null
}

const ZERO = (): Nutrients => ({ energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 })

export async function saveRecall(
  sb: SupabaseClient<Database>,
  args: SaveRecallArgs,
): Promise<{ id: string }> {
  const c = loose(sb)
  // Um recordatório por (paciente, data): substitui o do dia.
  await c
    .from('food_recalls')
    .delete()
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .eq('recall_date', args.recallDate)

  const created = await c
    .from('food_recalls')
    .insert({
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      recall_date: args.recallDate,
      notes: args.notes?.trim() || null,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (created.error) throw new Error(`saveRecall: ${created.error.message}`)
  const id = (created.data as { id: string }).id

  const rows: Record<string, unknown>[] = []
  for (const meal of args.meals) {
    for (let i = 0; i < meal.items.length; i++) {
      const it = meal.items[i]!
      if (!it.foodId) continue
      const grams = await resolveGrams(sb, it)
      rows.push({
        recall_id: id,
        tenant_id: args.tenantId,
        meal_name: meal.name.trim() || 'Refeição',
        position: meal.position * 100 + i,
        food_id: it.foodId,
        grams,
        measure_label: it.measureLabel?.trim() || null,
        measure_qty: it.measureQty ?? null,
      })
    }
  }
  if (rows.length > 0) {
    const ins = await c.from('food_recall_items').insert(rows)
    if (ins.error) throw new Error(`saveRecall items: ${ins.error.message}`)
  }
  return { id }
}

export async function listRecalls(
  sb: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<{ summaries: RecallSummary[]; latest: RecallView | null }> {
  const { data } = await loose(sb)
    .from('food_recalls')
    .select('id, recall_date')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .order('recall_date', { ascending: false })
    .limit(30)
  const recalls = (data ?? []) as Array<{ id: string; recall_date: string }>
  const summaries: RecallSummary[] = []
  let latest: RecallView | null = null
  for (const r of recalls) {
    const view = await getRecall(sb, tenantId, r.id)
    if (!view) continue
    summaries.push({ id: r.id, recallDate: r.recall_date, totalKcal: view.totals.energyKcal })
    if (!latest) latest = view
  }
  return { summaries, latest }
}

/**
 * Id do recordatório de uma data — ou o mais recente, quando a data é omitida.
 *
 * `listRecalls` também resolveria, mas monta a view completa de até 30
 * recordatórios (com carga de alimentos) só para descobrir um id. Aqui basta o
 * cabeçalho.
 */
export async function findRecallId(
  sb: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; recallDate?: string | null },
): Promise<string | null> {
  let q = loose(sb)
    .from('food_recalls')
    .select('id, recall_date')
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
  if (args.recallDate) q = q.eq('recall_date', args.recallDate)
  const { data } = await q.order('recall_date', { ascending: false }).limit(1).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function getRecall(
  sb: SupabaseClient<Database>,
  tenantId: string,
  recallId: string,
): Promise<RecallView | null> {
  const c = loose(sb)
  const head = await c
    .from('food_recalls')
    .select('id, recall_date, notes')
    .eq('tenant_id', tenantId)
    .eq('id', recallId)
    .maybeSingle()
  const r = head.data as { id: string; recall_date: string; notes: string | null } | null
  if (!r) return null

  const itemsRes = await c
    .from('food_recall_items')
    .select('meal_name, position, food_id, grams, measure_label, measure_qty')
    .eq('recall_id', recallId)
    .order('position', { ascending: true })
  const items = (itemsRes.data ?? []) as Array<{
    meal_name: string
    position: number
    food_id: string
    grams: number | null
    measure_label: string | null
    measure_qty: number | null
  }>
  const refs = await loadFoodRefs(
    sb,
    items.map((i) => i.food_id),
  )

  const byMeal = new Map<string, RecallItemView[]>()
  for (const it of items) {
    const ref = refs.get(it.food_id)
    const nutrients =
      ref && it.grams !== null
        ? roundNutrients(itemNutrients({ grams: Number(it.grams), food: ref }))
        : null
    const arr = byMeal.get(it.meal_name) ?? []
    arr.push({
      foodId: it.food_id,
      name: ref?.name ?? 'Alimento',
      grams: it.grams === null ? null : Number(it.grams),
      measureLabel: it.measure_label,
      measureQty: it.measure_qty === null ? null : Number(it.measure_qty),
      nutrients,
    })
    byMeal.set(it.meal_name, arr)
  }

  const meals: RecallMealView[] = [...byMeal.entries()].map(([name, its]) => ({
    name,
    items: its,
    totals: roundNutrients(its.map((i) => i.nutrients ?? ZERO()).reduce(addNutrients, ZERO())),
  }))
  const totals = roundNutrients(meals.map((m) => m.totals).reduce(addNutrients, ZERO()))
  return { id: r.id, recallDate: r.recall_date, notes: r.notes, meals, totals }
}
