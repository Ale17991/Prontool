import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

export interface TreatmentPlanStep {
  id: string
  title: string
  notes: string | null
  status: 'pendente' | 'concluido' | 'cancelado'
  scheduledDate: string | null
  completedAt: string | null
  createdAt: string
  procedure: {
    id: string
    tussCode: string
    displayName: string | null
  }
  healthPlan: {
    id: string
    name: string
  } | null
}

export interface TreatmentPlanDetail {
  id: string
  patientId: string
  title: string
  description: string | null
  status: 'ativo' | 'concluido' | 'cancelado'
  createdAt: string
  steps: TreatmentPlanStep[]
}

export interface GetTreatmentPlanInput {
  tenantId: string
  planId: string
}

/**
 * Carrega um plano com todas as etapas expandindo procedure (nome + TUSS) e
 * health_plan (nome). Usa join via select embedding do PostgREST — os FKs
 * procedure_id / plan_id resolvem as relações automaticamente.
 */
export async function getTreatmentPlan(
  supabase: SupabaseClient<Database>,
  input: GetTreatmentPlanInput,
): Promise<TreatmentPlanDetail> {
  const plan = await supabase
    .from('treatment_plans')
    .select('id, patient_id, title, description, status, created_at')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.planId)
    .maybeSingle()

  if (plan.error) throw new Error(`get treatment plan: ${plan.error.message}`)
  if (!plan.data) throw new NotFoundError('treatment_plan', input.planId)

  const stepsResult = await supabase
    .from('treatment_plan_steps')
    .select(
      'id, title, notes, status, scheduled_date, completed_at, created_at, ' +
        'procedures:procedure_id ( id, tuss_code, display_name ), ' +
        'health_plans:plan_id ( id, name )',
    )
    .eq('tenant_id', input.tenantId)
    .eq('treatment_plan_id', input.planId)
    .order('created_at', { ascending: true })

  if (stepsResult.error) throw new Error(`list steps: ${stepsResult.error.message}`)

  type RawStep = {
    id: string
    title: string
    notes: string | null
    status: string
    scheduled_date: string | null
    completed_at: string | null
    created_at: string
    procedures: { id: string; tuss_code: string; display_name: string | null } | null
    health_plans: { id: string; name: string } | null
  }
  const raw = (stepsResult.data ?? []) as unknown as RawStep[]

  const steps: TreatmentPlanStep[] = raw.map((s) => ({
    id: s.id,
    title: s.title,
    notes: s.notes,
    status: s.status as TreatmentPlanStep['status'],
    scheduledDate: s.scheduled_date,
    completedAt: s.completed_at,
    createdAt: s.created_at,
    procedure: s.procedures
      ? {
          id: s.procedures.id,
          tussCode: s.procedures.tuss_code,
          displayName: s.procedures.display_name,
        }
      : { id: '', tussCode: '—', displayName: null },
    healthPlan: s.health_plans ? { id: s.health_plans.id, name: s.health_plans.name } : null,
  }))

  return {
    id: plan.data.id,
    patientId: plan.data.patient_id,
    title: plan.data.title,
    description: plan.data.description,
    status: plan.data.status as TreatmentPlanDetail['status'],
    createdAt: plan.data.created_at,
    steps,
  }
}
