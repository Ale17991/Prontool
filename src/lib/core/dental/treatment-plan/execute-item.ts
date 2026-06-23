import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { updateTreatmentStepStatus } from '@/lib/core/treatment-steps/update-status'

/**
 * Marca um item de plano como executado (concluido), opcionalmente vinculando
 * a um atendimento. Para itens DENTAIS, exige orçamento aceito (gating também
 * garantido por trigger). O financeiro/repasse reage ao atendimento (feat. 023).
 */
export async function executePlanItem(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; stepId: string; appointmentId?: string | null; actorUserId: string },
): Promise<void> {
  const step = await supabase
    .from('treatment_plan_steps')
    .select('id, status, tooth_fdi, budget_id, appointment_id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.stepId)
    .maybeSingle()
  if (step.error) throw new Error(`step lookup: ${step.error.message}`)
  if (!step.data) throw new NotFoundError('treatment_plan_step', input.stepId)
  const row = step.data as {
    id: string
    status: string
    tooth_fdi: number | null
    budget_id: string | null
    appointment_id: string | null
  }

  // Gating para itens dentais: precisa de orçamento aceito.
  if (row.tooth_fdi !== null) {
    if (!row.budget_id) {
      throw new ValidationError('Item sem orçamento. Crie e aceite um orçamento antes de executar.')
    }
    const budget = await supabase
      .from('treatment_budgets')
      .select('status')
      .eq('id', row.budget_id)
      .maybeSingle()
    if (budget.error) throw new Error(`budget lookup: ${budget.error.message}`)
    if ((budget.data as { status: string } | null)?.status !== 'aceito') {
      throw new ValidationError('Execução exige orçamento aceito.')
    }
  }

  // Vincula atendimento (one-shot) se informado e ainda não vinculado.
  if (input.appointmentId && !row.appointment_id) {
    const link = await supabase
      .from('treatment_plan_steps')
      .update({ appointment_id: input.appointmentId })
      .eq('tenant_id', input.tenantId)
      .eq('id', input.stepId)
    if (link.error) throw new Error(`link appointment: ${link.error.message}`)
  }

  await updateTreatmentStepStatus(supabase, {
    tenantId: input.tenantId,
    stepId: input.stepId,
    status: 'concluido',
    actorUserId: input.actorUserId,
  })
}
