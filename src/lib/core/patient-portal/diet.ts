/**
 * Feature 032 — planos alimentares (com histórico via versão).
 * Criar um plano desativa o anterior (1 ativo/paciente). Histórico = inativos.
 * RBAC pelo caller. Tabelas novas (0121) → cliente solto (não tipadas ainda).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface DietMealItem {
  food: string
  quantity: string | null
  notes: string | null
}
export interface DietMeal {
  name: string
  timeLabel: string | null
  notes: string | null
  items: DietMealItem[]
}
export interface DietPlan {
  id: string
  title: string
  notes: string | null
  active: boolean
  createdAt: string
  meals: DietMeal[]
}
export interface DietPlanSummary {
  id: string
  title: string
  active: boolean
  createdAt: string
}

function loose(supabase: SupabaseClient<Database>): SupabaseClient {
  return supabase as unknown as SupabaseClient
}

export interface CreateDietPlanArgs {
  tenantId: string
  patientId: string
  title: string
  notes?: string | null
  meals: DietMeal[]
  actorUserId: string
}

export async function createDietPlan(
  supabase: SupabaseClient<Database>,
  args: CreateDietPlanArgs,
): Promise<{ id: string }> {
  const sb = loose(supabase)
  await sb
    .from('diet_plans')
    .update({ active: false })
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .eq('active', true)

  const planRes = await sb
    .from('diet_plans')
    .insert({
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      title: args.title.trim(),
      notes: args.notes?.trim() || null,
      active: true,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (planRes.error) throw new Error(`createDietPlan: ${planRes.error.message}`)
  const planId = (planRes.data as { id: string }).id

  for (let m = 0; m < args.meals.length; m++) {
    const meal = args.meals[m]!
    const mealRes = await sb
      .from('diet_meals')
      .insert({
        tenant_id: args.tenantId,
        plan_id: planId,
        position: m,
        name: meal.name.trim(),
        time_label: meal.timeLabel?.trim() || null,
        notes: meal.notes?.trim() || null,
      })
      .select('id')
      .single()
    if (mealRes.error) throw new Error(`createDietPlan meal: ${mealRes.error.message}`)
    const mealId = (mealRes.data as { id: string }).id
    if (meal.items.length > 0) {
      const rows = meal.items.map((it, i) => ({
        tenant_id: args.tenantId,
        meal_id: mealId,
        position: i,
        food: it.food.trim(),
        quantity: it.quantity?.trim() || null,
        notes: it.notes?.trim() || null,
      }))
      const itRes = await sb.from('diet_meal_items').insert(rows)
      if (itRes.error) throw new Error(`createDietPlan items: ${itRes.error.message}`)
    }
  }
  return { id: planId }
}

export async function listDietPlanSummaries(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<DietPlanSummary[]> {
  const { data, error } = await loose(supabase)
    .from('diet_plans')
    .select('id, title, active, created_at')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listDietPlanSummaries: ${error.message}`)
  return (
    (data ?? []) as Array<{ id: string; title: string; active: boolean; created_at: string }>
  ).map((r) => ({
    id: r.id,
    title: r.title,
    active: r.active,
    createdAt: r.created_at,
  }))
}

async function hydratePlan(
  supabase: SupabaseClient<Database>,
  planRow: { id: string; title: string; notes: string | null; active: boolean; created_at: string },
): Promise<DietPlan> {
  const sb = loose(supabase)
  const mealsRes = await sb
    .from('diet_meals')
    .select('id, name, time_label, notes, position')
    .eq('plan_id', planRow.id)
    .order('position', { ascending: true })
  const meals = (mealsRes.data ?? []) as Array<{
    id: string
    name: string
    time_label: string | null
    notes: string | null
  }>
  const out: DietMeal[] = []
  for (const m of meals) {
    const itRes = await sb
      .from('diet_meal_items')
      .select('food, quantity, notes, position')
      .eq('meal_id', m.id)
      .order('position', { ascending: true })
    const items = (
      (itRes.data ?? []) as Array<{ food: string; quantity: string | null; notes: string | null }>
    ).map((it) => ({
      food: it.food,
      quantity: it.quantity,
      notes: it.notes,
    }))
    out.push({ name: m.name, timeLabel: m.time_label, notes: m.notes, items })
  }
  return {
    id: planRow.id,
    title: planRow.title,
    notes: planRow.notes,
    active: planRow.active,
    createdAt: planRow.created_at,
    meals: out,
  }
}

export async function getActiveDietPlan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<DietPlan | null> {
  const { data } = await loose(supabase)
    .from('diet_plans')
    .select('id, title, notes, active, created_at')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .eq('active', true)
    .maybeSingle()
  if (!data) return null
  return hydratePlan(
    supabase,
    data as {
      id: string
      title: string
      notes: string | null
      active: boolean
      created_at: string
    },
  )
}

export async function getDietPlan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  planId: string,
): Promise<DietPlan | null> {
  const { data } = await loose(supabase)
    .from('diet_plans')
    .select('id, title, notes, active, created_at')
    .eq('tenant_id', tenantId)
    .eq('id', planId)
    .maybeSingle()
  if (!data) return null
  return hydratePlan(
    supabase,
    data as {
      id: string
      title: string
      notes: string | null
      active: boolean
      created_at: string
    },
  )
}

// =========================================================================
// Feature 047 US4 — entrega da PRESCRIÇÃO no portal do paciente.
// =========================================================================

/**
 * Nutrientes congelados na prescrição. `null` em qualquer nível significa
 * "não foi calculado" — nunca zero. O plano legado (032) é texto livre e não
 * tem nutriente nenhum; mostrar 0 g de proteína ali seria afirmar uma coisa
 * falsa sobre a comida do paciente.
 */
export interface PortalNutrients {
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number
}

export interface PortalDietItem {
  name: string
  quantity: string | null
  /** Nutrientes do item, como congelados na prescrição. */
  nutrients: PortalNutrients | null
  /** Grupo (lista de substituição): alimentos que o paciente pode trocar. */
  options: { name: string; grams: number }[] | null
}
export interface PortalDietMeal {
  name: string
  timeLabel: string | null
  items: PortalDietItem[]
  totals: PortalNutrients | null
}
export interface PortalDietPlan {
  title: string
  prescribedAt: string | null
  meals: PortalDietMeal[]
  totals: PortalNutrients | null
  /** Meta da avaliação nutricional vigente quando o plano foi prescrito. */
  target: { kcal: number; macros: { protG: number; carbG: number; fatG: number } | null } | null
  /** Atribuição das fontes (FR-020) quando o plano usa a base pronta. */
  attribution: boolean
}

/**
 * Lê os nutrientes do snapshot sem inventar o que falta. Um item prescrito
 * antes de o motor gravar fibra, por exemplo, volta com `null` na fibra em vez
 * de um zero que pareceria medição.
 */
function readNutrients(n: SnapNutrients | null | undefined): PortalNutrients | null {
  if (!n || typeof n.energyKcal !== 'number') return null
  return {
    energyKcal: n.energyKcal,
    proteinG: n.proteinG ?? 0,
    carbG: n.carbG ?? 0,
    fatG: n.fatG ?? 0,
    fiberG: n.fiberG ?? 0,
  }
}

interface SnapNutrients {
  energyKcal?: number
  proteinG?: number
  carbG?: number
  fatG?: number
  fiberG?: number
}
interface SnapItem {
  name: string
  grams: number | null
  measureLabel?: string | null
  measureQty?: number | null
  isGroup?: boolean
  options?: { name: string; grams: number }[] | null
  nutrients?: SnapNutrients | null
}
interface SnapMeal {
  name: string
  timeLabel?: string | null
  totals?: SnapNutrients | null
  items: SnapItem[]
}
interface Snapshot {
  title?: string
  totals?: SnapNutrients | null
  target?: {
    kcal?: number | null
    macros?: { protG?: number; carbG?: number; fatG?: number } | null
  } | null
  meals?: SnapMeal[]
}

/**
 * Plano a exibir no portal: prioriza a PRESCRIÇÃO mais recente (snapshot
 * imutável — SC-007). Sem prescrição, cai no plano de texto livre da feature
 * 032 (compat) — mas NUNCA num rascunho 047 (itens com food_id), que é
 * trabalho interno ainda não entregue.
 */
export async function getPortalDietPlan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<PortalDietPlan | null> {
  const sb = loose(supabase)

  const presc = await sb
    .from('diet_plan_prescriptions')
    .select('snapshot, prescribed_at')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .order('prescribed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (presc.data) {
    const row = presc.data as { snapshot: Snapshot; prescribed_at: string }
    const snap = row.snapshot ?? {}
    const meals: PortalDietMeal[] = (snap.meals ?? []).map((m) => ({
      name: m.name,
      timeLabel: m.timeLabel ?? null,
      totals: readNutrients(m.totals),
      items: (m.items ?? []).map((i) => ({
        name: i.name,
        quantity:
          i.measureLabel && i.measureQty
            ? `${i.measureQty} ${i.measureLabel}${i.grams ? ` (${i.grams} g)` : ''}`
            : i.grams
              ? `${i.grams} g`
              : null,
        nutrients: readNutrients(i.nutrients),
        options: i.isGroup && i.options && i.options.length > 0 ? i.options : null,
      })),
    }))
    const tgt = snap.target
    return {
      title: snap.title ?? 'Plano alimentar',
      prescribedAt: row.prescribed_at,
      meals,
      totals: readNutrients(snap.totals),
      // Meta sem kcal não é meta: sem ela, não há com o que comparar o plano.
      target:
        tgt && typeof tgt.kcal === 'number'
          ? {
              kcal: tgt.kcal,
              macros: tgt.macros
                ? {
                    protG: tgt.macros.protG ?? 0,
                    carbG: tgt.macros.carbG ?? 0,
                    fatG: tgt.macros.fatG ?? 0,
                  }
                : null,
            }
          : null,
      attribution: true,
    }
  }

  // Sem prescrição: só o plano LEGADO (032) de texto livre. Rascunho 047 fica oculto.
  const active = await getActiveDietPlan(supabase, tenantId, patientId)
  if (!active) return null
  // Itens estruturados (com food_id) DESTE plano → é rascunho 047 não entregue.
  const mealIdsRes = await sb
    .from('diet_meals')
    .select('id')
    .eq('plan_id', active.id)
    .eq('tenant_id', tenantId)
  const mealIds = ((mealIdsRes.data ?? []) as Array<{ id: string }>).map((m) => m.id)
  if (mealIds.length > 0) {
    const structured = await sb
      .from('diet_meal_items')
      .select('id', { count: 'exact', head: true })
      .in('meal_id', mealIds)
      .not('food_id', 'is', null)
    if ((structured.count ?? 0) > 0) return null
  }

  // Plano legado (032): texto livre, sem alimento da base e portanto sem
  // nutriente nenhum. Tudo volta `null` — o paciente vê o cardápio sem números,
  // que é a verdade, em vez de zeros que pareceriam cálculo.
  return {
    title: active.title,
    prescribedAt: null,
    meals: active.meals.map((m) => ({
      name: m.name,
      timeLabel: m.timeLabel,
      totals: null,
      items: m.items.map((it) => ({
        name: it.food,
        quantity: it.quantity,
        nutrients: null,
        options: null,
      })),
    })),
    totals: null,
    target: null,
    attribution: false,
  }
}
