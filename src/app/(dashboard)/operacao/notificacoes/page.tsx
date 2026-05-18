import { redirect } from 'next/navigation'
import { Bell } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { TabBar, type TabId } from './_components/tab-bar'
import { TabNotificacoes } from './_components/tab-notificacoes'
import { TabAlertas } from './_components/tab-alertas'
import { TabDlq } from './_components/tab-dlq'

/**
 * Feature 014 — US2 — página unificada acessada pelo sininho da topbar.
 * Renderiza três sub-seções via tab bar server-rendered:
 *  - Notificações (sempre visível)
 *  - Alertas do sistema (apenas com `alert.read`)
 *  - Pendências (apenas com `dlq.read`)
 *
 * Resolução da aba ativa:
 *   ?tab=... ∈ available? sim → renderiza essa aba.
 *                        não/ausente/proibida → cai silenciosamente em `notificacoes`.
 */

export const dynamic = 'force-dynamic'

const VALID_TABS: readonly TabId[] = ['notificacoes', 'alertas', 'dlq']

function parseTab(raw: unknown): TabId | null {
  if (typeof raw !== 'string') return null
  return (VALID_TABS as readonly string[]).includes(raw) ? (raw as TabId) : null
}

function parseStatus(raw: unknown): 'aberto' | 'resolvido' | 'todos' {
  if (raw === 'resolvido' || raw === 'todos') return raw
  return 'aberto'
}

interface PageProps {
  searchParams: {
    tab?: string
    status?: string
  }
}

export default async function NotificacoesPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const available: TabId[] = ['notificacoes']
  if (can(session.role, 'alert.read')) available.push('alertas')
  if (can(session.role, 'dlq.read')) available.push('dlq')

  const requested = parseTab(searchParams.tab)
  const active: TabId = requested && available.includes(requested) ? requested : 'notificacoes'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Bell className="h-6 w-6 text-primary" />
          Notificações
        </h1>
      </div>

      <TabBar active={active} available={available} />

      {active === 'notificacoes' ? (
        <TabNotificacoes tenantId={session.tenantId} userId={session.userId} />
      ) : null}

      {active === 'alertas' ? (
        <TabAlertas role={session.role} statusFilter={parseStatus(searchParams.status)} />
      ) : null}

      {active === 'dlq' ? <TabDlq role={session.role} /> : null}
    </div>
  )
}
