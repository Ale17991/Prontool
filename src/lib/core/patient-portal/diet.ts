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
  return ((data ?? []) as Array<{ id: string; title: string; active: boolean; created_at: string }>).map((r) => ({
    id: r.id,
    title: r.title,
    active: r.active,
    createdAt: r.created_at,
  }))
}

async function hydratePlan(supabase: SupabaseClient<Database>, planRow: { id: string; title: string; notes: string | null; active: boolean; created_at: string }): Promise<DietPlan> {
  const sb = loose(supabase)
  const mealsRes = await sb
    .from('diet_meals')
    .select('id, name, time_label, notes, position')
    .eq('plan_id', planRow.id)
    .order('position', { ascending: true })
  const meals = (mealsRes.data ?? []) as Array<{ id: string; name: string; time_label: string | null; notes: string | null }>
  const out: DietMeal[] = []
  for (const m of meals) {
    const itRes = await sb
      .from('diet_meal_items')
      .select('food, quantity, notes, position')
      .eq('meal_id', m.id)
      .order('position', { ascending: true })
    const items = ((itRes.data ?? []) as Array<{ food: string; quantity: string | null; notes: string | null }>).map((it) => ({
      food: it.food,
      quantity: it.quantity,
      notes: it.notes,
    }))
    out.push({ name: m.name, timeLabel: m.time_label, notes: m.notes, items })
  }
  return { id: planRow.id, title: planRow.title, notes: planRow.notes, active: planRow.active, createdAt: planRow.created_at, meals: out }
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
  return hydratePlan(supabase, data as { id: string; title: string; notes: string | null; active: boolean; created_at: string })
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
  return hydratePlan(supabase, data as { id: string; title: string; notes: string | null; active: boolean; created_at: string })
}
