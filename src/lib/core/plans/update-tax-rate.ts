import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

/**
 * T037 — Feature 011 — atualiza a alíquota tributária retida pelo convênio.
 *
 * Persiste `health_plans.tax_rate_bps` (default 0). Mudança é auditada
 * automaticamente pelo trigger `health_plans_tax_rate_audit` (migration 0076).
 *
 * Range válido [0, 10000] (CHECK no DB + defesa redundante aqui).
 *
 * RBAC: caller deve ter `plan.write` (admin) — verificado no route handler.
 */
export interface UpdatePlanTaxRateInput {
  tenantId: string
  planId: string
  taxRateBps: number
}

export async function updatePlanTaxRate(
  supabase: SupabaseClient<Database>,
  input: UpdatePlanTaxRateInput,
): Promise<{ id: string; name: string; active: boolean; tax_rate_bps: number }> {
  if (!Number.isInteger(input.taxRateBps) || input.taxRateBps < 0 || input.taxRateBps > 10000) {
    throw new ValidationError('tax_rate_bps inválido: inteiro entre 0 e 10000.')
  }

  const { data, error } = await supabase
    .from('health_plans')
    .update({ tax_rate_bps: input.taxRateBps } as never)
    .eq('id', input.planId)
    .eq('tenant_id', input.tenantId)
    .select('id, name, active, tax_rate_bps')
    .maybeSingle()

  if (error) throw new Error(`updatePlanTaxRate failed: ${error.message}`)
  if (!data) throw new NotFoundError('health_plan', input.planId)
  return data as { id: string; name: string; active: boolean; tax_rate_bps: number }
}
