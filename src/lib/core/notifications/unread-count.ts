import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 012 — US2 — rota leve para o badge do sininho.
 *
 * NÃO invoca a RPC de geração — apenas COUNT/EXISTS. Para gerar, chame
 * `generateUserNotifications` antes (página de notificações faz isso).
 */
export async function unreadNotificationsSummary(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; userId: string },
): Promise<{ count: number; has_overdue: boolean }> {
  const { count, error: countErr } = await supabase
    .from('notifications' as never)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.userId)
    .eq('is_read', false)
  if (countErr) throw new Error(`unreadCount failed: ${countErr.message}`)

  const { data: anyOverdue } = await supabase
    .from('notifications' as never)
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.userId)
    .eq('is_read', false)
    .eq('type', 'tarefa_atrasada')
    .limit(1)

  return {
    count: count ?? 0,
    has_overdue: (anyOverdue ?? []).length > 0,
  }
}
