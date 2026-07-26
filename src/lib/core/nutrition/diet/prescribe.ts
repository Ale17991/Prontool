import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError } from '@/lib/observability/errors'
import { getDietPlanForPatient } from './plan'

/**
 * Feature 047 US2 — prescrição do plano alimentar (FR-013/FR-017).
 *
 * Congela os nutrientes de cada item, grava o snapshot imutável e marca o plano
 * como prescrito — atomicamente via RPC `prescribe_diet_plan` (0178). O motor de
 * soma roda aqui (mesma função da tela); a RPC só persiste.
 */

export interface PrescribeResult {
  prescriptionId: string
  prescribedAt: string
  totalKcal: number
  totalMacros: { protG: number; carbG: number; fatG: number }
}

export async function prescribeDietPlan(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; actorUserId: string; planId: string },
): Promise<PrescribeResult> {
  const view = await getDietPlanForPatient(supabase, args.tenantId, args.patientId)
  if (!view || view.id !== args.planId) {
    throw new DomainError('DIET_PLAN_NOT_FOUND', 'Plano não encontrado.', { status: 404 })
  }
  if (view.status === 'prescrito') {
    throw new DomainError('DIET_PLAN_ALREADY_PRESCRIBED', 'Este plano já foi prescrito.', {
      status: 409,
    })
  }
  const hasCalcItem = view.meals.some((m) => m.items.some((i) => i.nutrients))
  if (!hasCalcItem) {
    throw new DomainError('DIET_PLAN_EMPTY', 'O plano não tem nenhum item calculável para prescrever.', {
      status: 422,
    })
  }

  // Snapshot congelado por item (motor já calculou em getDietPlanForPatient).
  const itemSnaps: Array<Record<string, unknown>> = []
  for (const meal of view.meals) {
    for (const item of meal.items) {
      if (!item.nutrients) continue
      itemSnaps.push({
        item_id: item.id,
        energy: item.nutrients.energyKcal,
        protein: item.nutrients.proteinG,
        carb: item.nutrients.carbG,
        fat: item.nutrients.fatG,
        fiber: item.nutrients.fiberG,
      })
    }
  }

  const totalMacros = { protG: view.totals.proteinG, carbG: view.totals.carbG, fatG: view.totals.fatG }

  // Snapshot inteiro do cardápio — fonte da verdade do portal (SC-007).
  const snapshot = {
    title: view.title,
    totals: view.totals,
    target: view.target,
    meals: view.meals.map((m) => ({
      name: m.name,
      timeLabel: m.timeLabel,
      totals: m.totals,
      items: m.items.map((i) => ({
        name: i.name,
        grams: i.grams,
        measureLabel: i.measureLabel,
        measureQty: i.measureQty,
        isGroup: i.isGroup,
        options: i.groupOptions,
        nutrients: i.nutrients,
      })),
    })),
  }

  const { data, error } = await supabase.rpc('prescribe_diet_plan', {
    p_tenant_id: args.tenantId,
    p_patient_id: args.patientId,
    p_plan_id: args.planId,
    p_actor_user_id: args.actorUserId,
    p_snapshot: snapshot as never,
    p_target_kcal: view.target?.kcal ?? null,
    p_target_macros: (view.target?.macros ?? null) as never,
    p_total_kcal: view.totals.energyKcal,
    p_total_macros: totalMacros as never,
    p_item_snaps: itemSnaps as never,
  } as never)
  if (error) throw new Error(`prescribeDietPlan: ${error.message}`)

  return {
    prescriptionId: data as unknown as string,
    prescribedAt: new Date().toISOString(),
    totalKcal: view.totals.energyKcal,
    totalMacros,
  }
}
