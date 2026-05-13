import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

/**
 * Feature 012 — US2 — marca uma notificação como lida.
 */
export async function markNotificationRead(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; userId: string; id: string },
): Promise<{ id: string; is_read: boolean; read_at: string }> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('notifications' as never)
    .update({ is_read: true, read_at: now } as never)
    .eq('id', args.id)
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.userId)
    .select('id, is_read, read_at')
    .maybeSingle()
  if (error) throw new Error(`markNotificationRead failed: ${error.message}`)
  if (!data) throw new NotFoundError('notification', args.id)
  return data as unknown as { id: string; is_read: boolean; read_at: string }
}
