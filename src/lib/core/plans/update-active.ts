import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * T163 — Atualiza somente o flag `active`. Renome bloqueado por design
 * (preserva integridade histórica de relatórios).
 */
export async function updatePlanActive(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; planId: string; active: boolean },
): Promise<{ id: string; name: string; active: boolean }> {
  const { data, error } = await supabase
    .from('health_plans')
    .update({ active: args.active })
    .eq('id', args.planId)
    .eq('tenant_id', args.tenantId)
    .select('id, name, active')
    .maybeSingle()
  if (error) throw new Error(`updatePlanActive failed: ${error.message}`)
  if (!data) throw new NotFoundError('health_plan', args.planId)
  return { id: data.id, name: data.name, active: data.active }
}
