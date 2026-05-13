import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * Feature 012 — US1 — soft-delete de tarefa. Admin-only — caller deve validar.
 */
export async function softDeleteTask(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; id: string; actorUserId: string },
): Promise<void> {
  const { data, error } = await supabase
    .from('tasks' as never)
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: args.actorUserId,
    } as never)
    .eq('id', args.id)
    .eq('tenant_id', args.tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`softDeleteTask failed: ${error.message}`)
  if (!data) throw new NotFoundError('task', args.id)
}
