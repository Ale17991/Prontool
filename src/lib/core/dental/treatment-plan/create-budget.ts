import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

export interface CreateBudgetInput {
  tenantId: string
  patientId: string
  title?: string | null
  stepIds: string[]
  actorUserId: string
}

/**
 * Cria um orçamento (proposta) agrupando itens de plano ainda não orçados.
 * Linka os steps via `budget_id`. Total é calculado em leitura/aceite — aqui
 * só vincula. Steps já em outro orçamento ou finalizados são rejeitados.
 */
export async function createBudget(
  supabase: SupabaseClient<Database>,
  input: CreateBudgetInput,
): Promise<{ id: string }> {
  if (input.stepIds.length === 0) {
    throw new ValidationError('Selecione ao menos um item para o orçamento.')
  }

  const steps = await supabase
    .from('treatment_plan_steps')
    .select('id, patient_id, status, budget_id')
    .eq('tenant_id', input.tenantId)
    .in('id', input.stepIds)
  if (steps.error) throw new Error(`steps lookup: ${steps.error.message}`)
  const rows = (steps.data ?? []) as Array<{
    id: string
    patient_id: string
    status: string
    budget_id: string | null
  }>
  if (rows.length !== input.stepIds.length) {
    throw new NotFoundError('treatment_plan_step')
  }
  for (const r of rows) {
    if (r.patient_id !== input.patientId) {
      throw new ValidationError('Item não pertence ao paciente.')
    }
    if (r.budget_id !== null) {
      throw new ValidationError('Item já faz parte de um orçamento.')
    }
    if (r.status !== 'pendente') {
      throw new ValidationError('Apenas itens pendentes podem ser orçados.')
    }
  }

  const budget = await supabase
    .from('treatment_budgets')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      title: input.title?.trim() || null,
      created_by: input.actorUserId,
    })
    .select('id')
    .single()
  if (budget.error || !budget.data) throw new Error(`createBudget failed: ${budget.error?.message}`)
  const budgetId = budget.data.id

  const link = await supabase
    .from('treatment_plan_steps')
    .update({ budget_id: budgetId })
    .eq('tenant_id', input.tenantId)
    .in('id', input.stepIds)
  if (link.error) throw new Error(`link steps to budget: ${link.error.message}`)

  return { id: budgetId }
}
