import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface ListedPlan {
  id: string
  name: string
  active: boolean
  createdAt: string
}

export async function listHealthPlans(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; includeInactive?: boolean },
): Promise<ListedPlan[]> {
  let q = supabase
    .from('health_plans')
    .select('id, name, active, created_at')
    .eq('tenant_id', args.tenantId)
    .order('name', { ascending: true })
  if (!args.includeInactive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw new Error(`listHealthPlans failed: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
    createdAt: r.created_at,
  }))
}
