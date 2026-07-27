import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'
import {
  itemNutrients,
  roundNutrients,
  targetDelta,
  groupNutrients,
  type FoodRef,
  type Nutrients,
  type TargetDelta,
} from './totals'
import { listEquivalenceLists, type EquivalenceListDTO } from '../foods/equivalence'

/**
 * Feature 047 US2 — montagem e leitura do plano alimentar rico (com cálculo).
 *
 * Um plano ativo por paciente (`diet_plans.active`), estado rascunho→prescrito.
 * O rascunho é editável (upsert do cardápio inteiro); prescrever congela.
 * Reusa as tabelas diet_* estendidas na 0176 e o motor puro `totals.ts`.
 */

function loose(supabase: SupabaseClient<Database>): SupabaseClient {
  return supabase as unknown as SupabaseClient
}

export interface PlanItemInputDTO {
  foodId?: string | null
  grams?: number | null
  measureLabel?: string | null
  measureQty?: number | null
  equivalenceListId?: string | null
  /** Opções efetivas do grupo p/ ESTE paciente (remover/adicionar trocas). */
  groupOptions?: { foodId: string; grams: number }[] | null
  notes?: string | null
}
export interface PlanMealInputDTO {
  name: string
  timeLabel?: string | null
  position: number
  items: PlanItemInputDTO[]
}
export interface SaveDietPlanArgs {
  tenantId: string
  patientId: string
  actorUserId: string
  title: string
  assessmentId?: string | null
  meals: PlanMealInputDTO[]
}

export interface PlanItemView {
  id: string
  foodId: string | null
  name: string
  grams: number | null
  measureLabel: string | null
  measureQty: number | null
  equivalenceListId: string | null
  /** Item é um grupo (lista de substituição) em vez de um alimento único. */
  isGroup: boolean
  /** Alimentos elegíveis do grupo (o "OU"), quando `isGroup` — já com as
   * personalizações do paciente (opções removidas/adicionadas). */
  groupOptions: { foodId: string; name: string; grams: number }[] | null
  /** Meta de kcal do grupo (da lista base) — p/ auto-calcular grama de novas opções. */
  groupReferenceKcal: number | null
  nutrients: Nutrients | null
}
export interface PlanMealView {
  id: string
  name: string
  timeLabel: string | null
  position: number
  items: PlanItemView[]
  totals: Nutrients
}
export interface PlanTarget {
  kcal: number
  macros: { protG: number; carbG: number; fatG: number } | null
  assessmentId: string | null
  assessedAt: string | null
}
export interface DietPlanView {
  id: string
  title: string
  status: 'rascunho' | 'prescrito'
  meals: PlanMealView[]
  totals: Nutrients
  target: PlanTarget | null
  delta: TargetDelta | null
}

/** Alimento resolvido para o cálculo (nutrientes por porção de referência). */
async function loadFoodRefs(
  supabase: SupabaseClient<Database>,
  foodIds: string[],
): Promise<Map<string, FoodRef & { name: string }>> {
  const map = new Map<string, FoodRef & { name: string }>()
  if (foodIds.length === 0) return map
  const { data, error } = await supabase
    .from('foods')
    .select('id, name, reference_grams, energy_kcal, protein_g, carb_g, fat_g, fiber_g')
    .in('id', foodIds)
  if (error) throw new Error(`loadFoodRefs: ${error.message}`)
  for (const f of (data ?? []) as Array<{
    id: string
    name: string
    reference_grams: number
    energy_kcal: number
    protein_g: number
    carb_g: number
    fat_g: number
    fiber_g: number | null
  }>) {
    map.set(f.id, {
      name: f.name,
      referenceGrams: Number(f.reference_grams),
      energyKcal: Number(f.energy_kcal),
      proteinG: Number(f.protein_g),
      carbG: Number(f.carb_g),
      fatG: Number(f.fat_g),
      fiberG: f.fiber_g === null ? null : Number(f.fiber_g),
    })
  }
  return map
}

/** Meta VET/macros da avaliação mais recente do paciente (feature 046). */
export async function getLatestAssessmentTarget(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<PlanTarget | null> {
  const { data } = await supabase
    .from('nutrition_assessments')
    .select('id, assessed_at, target_kcal, target_macros')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .not('target_kcal', 'is', null)
    .order('assessed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const row = data as {
    id: string
    assessed_at: string
    target_kcal: number | null
    target_macros: { protG?: number; carbG?: number; lipG?: number } | null
  }
  if (row.target_kcal === null) return null
  const m = row.target_macros
  return {
    kcal: Number(row.target_kcal),
    macros: m ? { protG: m.protG ?? 0, carbG: m.carbG ?? 0, fatG: m.lipG ?? 0 } : null,
    assessmentId: row.id,
    assessedAt: row.assessed_at,
  }
}

/** Resolve gramas do item: prioriza `grams`; senão converte medida caseira. */
async function resolveGrams(
  supabase: SupabaseClient<Database>,
  item: PlanItemInputDTO,
): Promise<number | null> {
  if (typeof item.grams === 'number' && item.grams > 0) return item.grams
  if (item.foodId && item.measureLabel && typeof item.measureQty === 'number' && item.measureQty > 0) {
    const { data } = await supabase
      .from('food_household_measures')
      .select('grams')
      .eq('food_id', item.foodId)
      .eq('label', item.measureLabel)
      .limit(1)
      .maybeSingle()
    const g = (data as { grams: number } | null)?.grams
    if (g) return Number(g) * item.measureQty
  }
  return null
}

/** Cria ou atualiza o rascunho ativo do paciente (upsert do cardápio inteiro). */
export async function saveDietPlanDraft(
  supabase: SupabaseClient<Database>,
  args: SaveDietPlanArgs,
): Promise<{ id: string }> {
  const sb = loose(supabase)
  const title = args.title.trim() || 'Plano alimentar'

  // Meta congelada no plano (copiada da avaliação — estável, ver data-model D).
  let target: PlanTarget | null = null
  if (args.assessmentId) {
    const t = await getLatestAssessmentTarget(supabase, args.tenantId, args.patientId)
    if (t && t.assessmentId === args.assessmentId) target = t
  }

  // Plano ativo atual. Rascunho → edita no lugar; prescrito → nova versão.
  const activeRes = await sb
    .from('diet_plans')
    .select('id, status')
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .eq('active', true)
    .maybeSingle()
  const active = activeRes.data as { id: string; status: string } | null

  let planId: string
  if (active && active.status === 'rascunho') {
    planId = active.id
    const upd = await sb
      .from('diet_plans')
      .update({
        title,
        assessment_id: args.assessmentId ?? null,
        target_kcal: target?.kcal ?? null,
        target_macros: target?.macros ?? null,
      })
      .eq('id', planId)
    if (upd.error) throw new Error(`saveDietPlanDraft update: ${upd.error.message}`)
    // Substitui o cardápio: apaga refeições (cascata nos itens) e reinsere.
    await sb.from('diet_meals').delete().eq('plan_id', planId).eq('tenant_id', args.tenantId)
  } else {
    if (active) {
      const deact = await sb.from('diet_plans').update({ active: false }).eq('id', active.id)
      if (deact.error) throw new Error(`saveDietPlanDraft deactivate: ${deact.error.message}`)
    }
    const created = await sb
      .from('diet_plans')
      .insert({
        tenant_id: args.tenantId,
        patient_id: args.patientId,
        title,
        active: true,
        status: 'rascunho',
        assessment_id: args.assessmentId ?? null,
        target_kcal: target?.kcal ?? null,
        target_macros: target?.macros ?? null,
        created_by_user_id: args.actorUserId,
      })
      .select('id')
      .single()
    if (created.error) throw new Error(`saveDietPlanDraft plan: ${created.error.message}`)
    planId = (created.data as { id: string }).id
  }

  // Reinsere refeições e itens.
  const foodIds = args.meals.flatMap((m) => m.items.map((i) => i.foodId).filter(Boolean)) as string[]
  const refs = await loadFoodRefs(supabase, foodIds)

  for (const meal of args.meals) {
    const mealRes = await sb
      .from('diet_meals')
      .insert({
        tenant_id: args.tenantId,
        plan_id: planId,
        position: meal.position,
        name: meal.name.trim() || 'Refeição',
        time_label: meal.timeLabel?.trim() || null,
      })
      .select('id')
      .single()
    if (mealRes.error) throw new Error(`saveDietPlanDraft meal: ${mealRes.error.message}`)
    const mealId = (mealRes.data as { id: string }).id

    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < meal.items.length; i++) {
      const it = meal.items[i]!
      const grams = await resolveGrams(supabase, it)
      const foodName = it.foodId ? (refs.get(it.foodId)?.name ?? 'Alimento') : (it.notes?.trim() || 'Item')
      rows.push({
        tenant_id: args.tenantId,
        meal_id: mealId,
        position: i,
        food: foodName, // nome congelado no momento (legado NOT NULL + legibilidade)
        food_id: it.foodId ?? null,
        grams,
        measure_label: it.measureLabel?.trim() || null,
        measure_qty: it.measureQty ?? null,
        equivalence_list_id: it.equivalenceListId ?? null,
        group_options:
          it.groupOptions && it.groupOptions.length > 0
            ? it.groupOptions.map((o) => ({ food_id: o.foodId, grams: o.grams }))
            : null,
        quantity: grams ? `${grams} g` : (it.measureLabel ?? null),
        notes: it.notes?.trim() || null,
      })
    }
    if (rows.length > 0) {
      const itRes = await sb.from('diet_meal_items').insert(rows)
      if (itRes.error) throw new Error(`saveDietPlanDraft items: ${itRes.error.message}`)
    }
  }

  return { id: planId }
}

/** Lê o plano ativo do paciente com nutrientes calculados ao vivo + delta. */
export async function getDietPlanForPatient(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<DietPlanView | null> {
  const sb = loose(supabase)
  const planRes = await sb
    .from('diet_plans')
    .select('id, title, status, target_kcal, target_macros, assessment_id')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .eq('active', true)
    .maybeSingle()
  const plan = planRes.data as {
    id: string
    title: string
    status: 'rascunho' | 'prescrito'
    target_kcal: number | null
    target_macros: { protG?: number; carbG?: number; fatG?: number } | null
    assessment_id: string | null
  } | null
  if (!plan) return null

  const mealsRes = await sb
    .from('diet_meals')
    .select('id, name, time_label, position')
    .eq('plan_id', plan.id)
    .order('position', { ascending: true })
  const mealRows = (mealsRes.data ?? []) as Array<{
    id: string
    name: string
    time_label: string | null
    position: number
  }>

  const allItems: Array<{
    id: string
    meal_id: string
    food_id: string | null
    food: string
    grams: number | null
    measure_label: string | null
    measure_qty: number | null
    equivalence_list_id: string | null
    group_options: unknown
    snap_energy_kcal: number | null
    snap_protein_g: number | null
    snap_carb_g: number | null
    snap_fat_g: number | null
    snap_fiber_g: number | null
    position: number
  }> = []
  if (mealRows.length > 0) {
    const itemsRes = await sb
      .from('diet_meal_items')
      .select(
        'id, meal_id, food_id, food, grams, measure_label, measure_qty, equivalence_list_id, group_options, snap_energy_kcal, snap_protein_g, snap_carb_g, snap_fat_g, snap_fiber_g, position',
      )
      .in(
        'meal_id',
        mealRows.map((m) => m.id),
      )
      .order('position', { ascending: true })
    allItems.push(...((itemsRes.data ?? []) as typeof allItems))
  }

  // Itens que são grupo (lista de substituição) precisam da lista base (nome +
  // meta). Carrega só se houver algum grupo.
  const listsById = new Map<string, EquivalenceListDTO>()
  if (allItems.some((i) => i.equivalence_list_id && !i.food_id)) {
    for (const l of await listEquivalenceLists(supabase, tenantId)) listsById.set(l.id, l)
  }

  function parseGroupOptions(v: unknown): { foodId: string; grams: number }[] | null {
    if (!Array.isArray(v)) return null
    const out = (v as Array<{ food_id?: string; grams?: number | string }>)
      .filter((o) => o && o.food_id)
      .map((o) => ({ foodId: String(o.food_id), grams: Number(o.grams) }))
      .filter((o) => o.grams > 0)
    return out.length ? out : null
  }
  // Opções efetivas do grupo: personalizadas (group_options) ou a lista base.
  function effectiveOptions(row: (typeof allItems)[number]): { foodId: string; grams: number }[] {
    const custom = parseGroupOptions(row.group_options)
    if (custom) return custom
    const list = row.equivalence_list_id ? listsById.get(row.equivalence_list_id) : undefined
    return list ? list.items.map((it) => ({ foodId: it.foodId, grams: it.grams })) : []
  }

  // Carrega TODOS os alimentos referenciados: item único + opções dos grupos.
  const groupOptionIds = allItems
    .filter((i) => !i.food_id && i.equivalence_list_id)
    .flatMap((i) => effectiveOptions(i).map((o) => o.foodId))
  const refs = await loadFoodRefs(supabase, [
    ...(allItems.map((i) => i.food_id).filter(Boolean) as string[]),
    ...groupOptionIds,
  ])

  function itemView(row: (typeof allItems)[number]): PlanItemView {
    const list = row.equivalence_list_id ? listsById.get(row.equivalence_list_id) : undefined
    const isGroup = !row.food_id && !!row.equivalence_list_id
    const opts = isGroup ? effectiveOptions(row) : []
    // Prescrito: usa o snapshot congelado; rascunho: calcula ao vivo da base.
    let nutrients: Nutrients | null = null
    if (row.snap_energy_kcal !== null) {
      nutrients = {
        energyKcal: Number(row.snap_energy_kcal),
        proteinG: Number(row.snap_protein_g ?? 0),
        carbG: Number(row.snap_carb_g ?? 0),
        fatG: Number(row.snap_fat_g ?? 0),
        fiberG: Number(row.snap_fiber_g ?? 0),
      }
    } else if (row.food_id && row.grams !== null && refs.has(row.food_id)) {
      nutrients = roundNutrients(itemNutrients({ grams: Number(row.grams), food: refs.get(row.food_id)! }))
    } else if (isGroup) {
      // Energia contada = meta da lista (reference_kcal), estável mesmo quando a
      // nutri remove/adiciona opções (o grupo é 1 porção ~ meta). Sem lista base
      // (raro), cai no cálculo pelas opções efetivas.
      nutrients = list
        ? roundNutrients(list.nutrients)
        : roundNutrients(
            groupNutrients({
              referenceKcal: null,
              items: opts
                .filter((o) => refs.has(o.foodId))
                .map((o) => ({ grams: o.grams, food: refs.get(o.foodId)! })),
            }),
          )
    }
    return {
      id: row.id,
      foodId: row.food_id,
      name: isGroup ? (list?.name ?? row.food) : row.food_id ? (refs.get(row.food_id)?.name ?? row.food) : row.food,
      grams: row.grams === null ? null : Number(row.grams),
      measureLabel: row.measure_label,
      measureQty: row.measure_qty === null ? null : Number(row.measure_qty),
      equivalenceListId: row.equivalence_list_id,
      isGroup,
      groupOptions: isGroup
        ? opts.map((o) => ({ foodId: o.foodId, name: refs.get(o.foodId)?.name ?? 'Alimento', grams: o.grams }))
        : null,
      groupReferenceKcal: isGroup ? (list?.referenceKcal ?? null) : null,
      nutrients,
    }
  }

  // Soma direta dos nutrientes já calculados por item (rascunho: ao vivo da
  // base; prescrito: snapshot congelado). Não passa pelo mealTotals porque os
  // nutrientes por item já foram resolvidos acima (podem vir do snapshot).
  function sumItems(items: PlanItemView[]): Nutrients {
    return items.reduce<Nutrients>(
      (acc, i) =>
        i.nutrients
          ? {
              energyKcal: acc.energyKcal + i.nutrients.energyKcal,
              proteinG: acc.proteinG + i.nutrients.proteinG,
              carbG: acc.carbG + i.nutrients.carbG,
              fatG: acc.fatG + i.nutrients.fatG,
              fiberG: acc.fiberG + i.nutrients.fiberG,
            }
          : acc,
      { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 },
    )
  }

  const meals: PlanMealView[] = mealRows.map((m) => {
    const items = allItems.filter((i) => i.meal_id === m.id).map(itemView)
    return {
      id: m.id,
      name: m.name,
      timeLabel: m.time_label,
      position: m.position,
      items,
      totals: roundNutrients(sumItems(items)),
    }
  })

  const dayTotal = roundNutrients(
    meals.reduce<Nutrients>(
      (acc, m) => ({
        energyKcal: acc.energyKcal + m.totals.energyKcal,
        proteinG: acc.proteinG + m.totals.proteinG,
        carbG: acc.carbG + m.totals.carbG,
        fatG: acc.fatG + m.totals.fatG,
        fiberG: acc.fiberG + m.totals.fiberG,
      }),
      { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 },
    ),
  )

  const target: PlanTarget | null =
    plan.target_kcal !== null
      ? {
          kcal: Number(plan.target_kcal),
          macros: plan.target_macros
            ? {
                protG: plan.target_macros.protG ?? 0,
                carbG: plan.target_macros.carbG ?? 0,
                fatG: plan.target_macros.fatG ?? 0,
              }
            : null,
          assessmentId: plan.assessment_id,
          assessedAt: null,
        }
      : null

  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    meals,
    totals: dayTotal,
    target,
    delta: targetDelta(dayTotal, target ? { kcal: target.kcal, macros: target.macros } : null),
  }
}
