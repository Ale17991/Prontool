import { Bell } from 'lucide-react'
import { generateUserNotifications } from '@/lib/core/notifications/generate'
import { listNotifications } from '@/lib/core/notifications/list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { NotificationItem } from '../notification-item'
import { MarkAllButton } from '../mark-all-button'

/**
 * Feature 014 — US2 — sub-seção "Notificações" da página unificada.
 * Carrega e renderiza apenas as notificações pessoais do usuário.
 * Comportamento idêntico ao da página original (antes da feature 014);
 * foi apenas extraído pra um componente para coexistir com as outras
 * abas em /operacao/notificacoes.
 */

interface Props {
  tenantId: string
  userId: string
}

export async function TabNotificacoes({ tenantId, userId }: Props) {
  const supabase = createSupabaseServiceClient()
  try {
    await generateUserNotifications(supabase, { tenantId, userId })
  } catch {
    // best-effort; listamos o que existir
  }
  const { items, unread_count, has_overdue } = await listNotifications(supabase, {
    tenantId,
    userId,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-500">
          {items.length} notificaç{items.length === 1 ? 'ão' : 'ões'} · {unread_count} não lida
          {unread_count === 1 ? '' : 's'}
          {has_overdue ? ' · contém tarefa atrasada' : ''}.
        </p>
        {unread_count > 0 ? <MarkAllButton /> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Suas notificações</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <Bell className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                Tudo em dia. Sem notificações no momento.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((n) => (
                <NotificationItem key={n.id} notification={n} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
