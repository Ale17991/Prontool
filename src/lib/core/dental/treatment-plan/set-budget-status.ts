import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { listTreatmentSteps } from '@/lib/core/treatment-steps/list'

export type BudgetAction = 'apresentar' | 'aceitar' | 'recusar'

/**
 * Avança o ciclo do orçamento. No aceite, calcula a soma dos preços resolvidos
 * dos itens vinculados e grava `frozen_total_cents` (snapshot). O trigger de
 * banco valida transições e a imutabilidade de aceito/recusado.
 */
export async function setBudgetStatus(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; patientId: string; budgetId: string; action: BudgetAction },
): Promise<{ status: string; frozenTotalCents: number | null }> {
  const current = await supabase
    .from('treatment_budgets')
    .select('id, status')
    .eq('tenant_id', input.tenantId)
    .eq('patient_id', input.patientId)
    .eq('id', input.budgetId)
    .maybeSingle()
  if (current.error) throw new Error(`budget lookup: ${current.error.message}`)
  if (!current.data) throw new NotFoundError('treatment_budget', input.budgetId)

  const nowIso = new Date().toISOString()
  interface BudgetPatch {
    status: string
    presented_at?: string
    refused_at?: string
    accepted_at?: string
    frozen_total_cents?: number
  }
  let patch: BudgetPatch

  if (input.action === 'apresentar') {
    patch = { status: 'apresentado', presented_at: nowIso }
  } else if (input.action === 'recusar') {
    patch = { status: 'recusado', refused_at: nowIso }
  } else {
    // aceitar — congela o total a partir dos preços resolvidos dos itens.
    const items = await listTreatmentSteps(supabase, {
      tenantId: input.tenantId,
      patientId: input.patientId,
    })
    const linked = items.filter((s) => s.budgetId === input.budgetId && s.status !== 'cancelado')
    if (linked.length === 0) {
      throw new ValidationError('Orçamento sem itens ativos não pode ser aceito.')
    }
    const total = linked.reduce((sum, s) => sum + (s.currentPriceCents ?? 0), 0)
    patch = { status: 'aceito', accepted_at: nowIso, frozen_total_cents: total }
  }

  const res = await supabase
    .from('treatment_budgets')
    .update(patch)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.budgetId)
    .select('status, frozen_total_cents')
    .maybeSingle()
  if (res.error) {
    if (res.error.code === '42501') {
      throw new ValidationError('Transição de orçamento inválida ou orçamento já finalizado.')
    }
    throw new Error(`setBudgetStatus failed: ${res.error.message}`)
  }
  if (!res.data) throw new NotFoundError('treatment_budget', input.budgetId)
  const row = res.data as { status: string; frozen_total_cents: number | null }
  return { status: row.status, frozenTotalCents: row.frozen_total_cents }
}
