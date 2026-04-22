import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'

export interface UpdateTreatmentStepStatusInput {
  tenantId: string
  stepId: string
  status: 'concluido' | 'cancelado'
  actorUserId: string
}

/**
 * Muda o status de uma etapa. Etapas já finalizadas (concluido/cancelado)
 * não podem ser re-transicionadas — append-only a nível do status. Carimba
 * completed_at/by quando status=concluido.
 */
export async function updateTreatmentStepStatus(
  supabase: SupabaseClient<Database>,
  input: UpdateTreatmentStepStatusInput,
): Promise<void> {
  if (input.status !== 'concluido' && input.status !== 'cancelado') {
    throw new ValidationError(`Status inválido: ${input.status as string}`)
  }

  const current = await supabase
    .from('treatment_plan_steps')
    .select('id, status')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.stepId)
    .maybeSingle()
  if (current.error) throw new Error(`step lookup: ${current.error.message}`)
  if (!current.data) throw new NotFoundError('treatment_plan_step', input.stepId)

  if (current.data.status !== 'pendente') {
    throw new ConflictError(
      'STEP_ALREADY_FINALIZED',
      `Etapa já finalizada como "${current.data.status}" — não pode ser alterada.`,
      { current_status: current.data.status },
    )
  }

  const patch =
    input.status === 'concluido'
      ? {
          status: 'concluido' as const,
          completed_at: new Date().toISOString(),
          completed_by: input.actorUserId,
        }
      : { status: 'cancelado' as const }

  const res = await supabase
    .from('treatment_plan_steps')
    .update(patch)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.stepId)
  if (res.error) throw new Error(`update step status: ${res.error.message}`)
}
