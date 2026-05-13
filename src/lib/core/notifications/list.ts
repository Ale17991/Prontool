import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export type NotificationType =
  | 'atendimento'
  | 'tarefa'
  | 'tarefa_atrasada'
  | 'aniversarios_mes'

export interface NotificationRow {
  id: string
  tenant_id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  reference_id: string | null
  reference_type: 'appointment' | 'task' | 'month' | null
  reference_key: string
  is_read: boolean
  read_at: string | null
  created_at: string
}

export interface ListNotificationsResult {
  items: NotificationRow[]
  unread_count: number
  has_overdue: boolean
}

/**
 * Feature 012 — US2 — lista as últimas 100 notificações do usuário,
 * mais o resumo de não lidas + has_overdue.
 */
export async function listNotifications(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; userId: string },
): Promise<ListNotificationsResult> {
  const { data, error } = await supabase
    .from('notifications' as never)
    .select(
      'id, tenant_id, user_id, type, title, body, reference_id, reference_type, reference_key, is_read, read_at, created_at',
    )
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.userId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`listNotifications failed: ${error.message}`)
  const items = (data ?? []) as unknown as NotificationRow[]
  const unread = items.filter((n) => !n.is_read)
  return {
    items,
    unread_count: unread.length,
    has_overdue: unread.some((n) => n.type === 'tarefa_atrasada'),
  }
}
