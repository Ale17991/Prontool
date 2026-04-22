import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

export interface AddTreatmentPlanStepInput {
  tenantId: string
  planId: string
  procedureId: string
  healthPlanId?: string | null
  title: string
  notes?: string | null
  scheduledDate?: string | null // YYYY-MM-DD
  actorUserId: string
}

export interface AddTreatmentPlanStepResult {
  id: string
}

/**
 * Adiciona uma etapa ao plano. Valida tenant, existência do plano + status,
 * e que o procedure (+ plano de saúde, se informado) pertencem ao tenant.
 * Etapas em planos "concluido" ou "cancelado" não são permitidas.
 */
export async function addTreatmentPlanStep(
  supabase: SupabaseClient<Database>,
  input: AddTreatmentPlanStepInput,
): Promise<AddTreatmentPlanStepResult> {
  const plan = await supabase
    .from('treatment_plans')
    .select('id, status')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.planId)
    .maybeSingle()
  if (plan.error) throw new Error(`plan lookup: ${plan.error.message}`)
  if (!plan.data) throw new NotFoundError('treatment_plan', input.planId)
  if (plan.data.status !== 'ativo') {
    throw new ValidationError(
      `Não é possível adicionar etapas a um plano ${plan.data.status}.`,
    )
  }

  const proc = await supabase
    .from('procedures')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.procedureId)
    .maybeSingle()
  if (proc.error) throw new Error(`procedure lookup: ${proc.error.message}`)
  if (!proc.data) throw new NotFoundError('procedure', input.procedureId)

  if (input.healthPlanId) {
    const hp = await supabase
      .from('health_plans')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('id', input.healthPlanId)
      .maybeSingle()
    if (hp.error) throw new Error(`health plan lookup: ${hp.error.message}`)
    if (!hp.data) throw new NotFoundError('health_plan', input.healthPlanId)
  }

  const { data, error } = await supabase
    .from('treatment_plan_steps')
    .insert({
      tenant_id: input.tenantId,
      treatment_plan_id: input.planId,
      procedure_id: input.procedureId,
      plan_id: input.healthPlanId ?? null,
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      scheduled_date: input.scheduledDate ?? null,
      created_by: input.actorUserId,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`addTreatmentPlanStep failed: ${error?.message}`)
  return { id: data.id }
}
