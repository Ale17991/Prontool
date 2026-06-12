import { redirect } from 'next/navigation'
import { CalendarClock } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { isGoogleOAuthConfigured } from '@/lib/integrations/google-calendar/oauth/env'
import { readGoogleConnection } from '@/lib/integrations/google-calendar/oauth/token-store'
import { GoogleAgendaCard } from './google-agenda-card'

export const dynamic = 'force-dynamic'

/**
 * Conexão da agenda Google do PROFISSIONAL (por usuário). Cada membro conecta a
 * própria conta — atendimentos criados entram na sua agenda pessoal.
 */
export default async function GoogleAgendaPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const configured = isGoogleOAuthConfigured()
  let connected = false
  let email: string | null = null
  let needsReconnect = false

  if (configured) {
    const supabase = createSupabaseServiceClient()
    const conn = await readGoogleConnection(supabase, session.userId, session.tenantId)
    connected = Boolean(conn && conn.row.enabled && conn.row.status === 'connected')
    needsReconnect = Boolean(conn && conn.row.status === 'token_expired')
    email = conn?.config.account_email ?? null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <CalendarClock className="h-6 w-6 text-primary" />
          Google Agenda
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Conecte sua conta Google para que os atendimentos agendados para você (pela clínica ou pelo
          link público) entrem automaticamente na sua agenda pessoal.
        </p>
      </div>

      <GoogleAgendaCard
        configured={configured}
        connected={connected}
        needsReconnect={needsReconnect}
        email={email}
      />
    </div>
  )
}
