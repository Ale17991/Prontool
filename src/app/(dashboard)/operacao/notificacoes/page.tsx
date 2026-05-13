import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Bell } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { generateUserNotifications } from '@/lib/core/notifications/generate'
import { listNotifications } from '@/lib/core/notifications/list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotificationItem } from './notification-item'
import { MarkAllButton } from './mark-all-button'

export const dynamic = 'force-dynamic'

export default async function NotificacoesPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServiceClient()
  // Lazy generate (best-effort).
  try {
    await generateUserNotifications(supabase, {
      tenantId: session.tenantId,
      userId: session.userId,
    })
  } catch {
    // ignora — listamos o que existir.
  }
  const { items, unread_count, has_overdue } = await listNotifications(supabase, {
    tenantId: session.tenantId,
    userId: session.userId,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
            <Bell className="h-6 w-6 text-primary" />
            Notificações
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {items.length} notificaç{items.length === 1 ? 'ão' : 'ões'} ·{' '}
            {unread_count} não lida{unread_count === 1 ? '' : 's'}
            {has_overdue ? ' · contém tarefa atrasada' : ''}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unread_count > 0 ? <MarkAllButton /> : null}
          <Link
            href="/operacao/alertas"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Alertas do sistema
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Suas notificações</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              Tudo em dia. Sem notificações no momento.
            </p>
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
