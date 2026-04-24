import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError } from '@/lib/observability/errors'

/**
 * T163 — Cria plano de saúde. Renome posterior é proibido (PATCH só
 * aceita `active`); preserva integridade dos relatórios históricos.
 */
export interface CreatePlanInput {
  tenantId: string
  name: string
}

export interface HealthPlanRow {
  id: string
  name: string
  active: boolean
  createdAt: string
}

export async function createHealthPlan(
  supabase: SupabaseClient<Database>,
  input: CreatePlanInput,
): Promise<HealthPlanRow> {
  const { data, error } = await supabase
    .from('health_plans')
    .insert({ tenant_id: input.tenantId, name: input.name })
    .select('id, name, active, created_at')
    .single()
  if (error) {
    if (error.code === '23505') {
      throw new ConflictError('HEALTH_PLAN_DUPLICATE', `Plan named "${input.name}" already exists in tenant`, {
        name: input.name,
      })
    }
    throw new Error(`createHealthPlan failed: ${error.message}`)
  }
  return { id: data.id, name: data.name, active: data.active, createdAt: data.created_at }
}
