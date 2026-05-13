import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 012 — US2 — marca todas as notificações não lidas do usuário como lidas.
 */
export async function markAllNotificationsRead(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; userId: string },
): Promise<{ updated: number }> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('notifications' as never)
    .update({ is_read: true, read_at: now } as never)
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.userId)
    .eq('is_read', false)
    .select('id')
  if (error) throw new Error(`markAllNotificationsRead failed: ${error.message}`)
  return { updated: (data ?? []).length }
}
