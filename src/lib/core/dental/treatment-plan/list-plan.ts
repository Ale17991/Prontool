import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { listTreatmentSteps, type TreatmentStep } from '@/lib/core/treatment-steps/list'

export type BudgetStatus = 'proposto' | 'apresentado' | 'aceito' | 'recusado'

export interface BudgetDTO {
  id: string
  title: string | null
  status: BudgetStatus
  frozenTotalCents: number | null
  presentedAt: string | null
  acceptedAt: string | null
  refusedAt: string | null
  createdAt: string
}

export interface PlanProgress {
  totalItems: number
  executedItems: number
  plannedValueCents: number
  executedValueCents: number
  hasItemsWithoutPrice: boolean
}

export interface PlanView {
  items: TreatmentStep[]
  budgets: BudgetDTO[]
  progress: PlanProgress
}

interface BudgetRow {
  id: string
  title: string | null
  status: string
  frozen_total_cents: number | null
  presented_at: string | null
  accepted_at: string | null
  refused_at: string | null
  created_at: string
}

/**
 * Visão do plano de tratamento do paciente: itens (reusa `listTreatmentSteps`,
 * já com posição/preço/atendimento), orçamentos e progresso agregado.
 */
export async function listPlan(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; patientPlanId?: string | null },
): Promise<PlanView> {
  const [items, budgetsRes] = await Promise.all([
    listTreatmentSteps(supabase, {
      tenantId: args.tenantId,
      patientId: args.patientId,
      patientPlanId: args.patientPlanId ?? null,
    }),
    supabase
      .from('treatment_budgets')
      .select(
        'id, title, status, frozen_total_cents, presented_at, accepted_at, refused_at, created_at',
      )
      .eq('tenant_id', args.tenantId)
      .eq('patient_id', args.patientId)
      .order('created_at', { ascending: false }),
  ])
  if (budgetsRes.error) throw new Error(`listPlan budgets failed: ${budgetsRes.error.message}`)

  const budgets: BudgetDTO[] = ((budgetsRes.data ?? []) as unknown as BudgetRow[]).map((b) => ({
    id: b.id,
    title: b.title,
    status: b.status as BudgetStatus,
    frozenTotalCents: b.frozen_total_cents,
    presentedAt: b.presented_at,
    acceptedAt: b.accepted_at,
    refusedAt: b.refused_at,
    createdAt: b.created_at,
  }))

  const active = items.filter((s) => s.status !== 'cancelado')
  const executed = active.filter((s) => s.status === 'concluido')
  const progress: PlanProgress = {
    totalItems: active.length,
    executedItems: executed.length,
    plannedValueCents: active.reduce((sum, s) => sum + (s.currentPriceCents ?? 0), 0),
    executedValueCents: executed.reduce((sum, s) => sum + (s.currentPriceCents ?? 0), 0),
    hasItemsWithoutPrice: active.some((s) => s.currentPriceCents === null),
  }

  return { items, budgets, progress }
}
