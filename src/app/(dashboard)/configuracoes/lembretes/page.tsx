import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BellRing } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { getReminderConfig } from '@/lib/core/reminders/config'
import { listRemindersHistory } from '@/lib/core/reminders/history'
import { ConfigForm } from './config-form'
import { HistoryTable } from './history-table'

export const dynamic = 'force-dynamic'

export default async function LembretesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'reminders.config')) redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const [config, history] = await Promise.all([
    getReminderConfig(supabase, session.tenantId),
    listRemindersHistory(supabase, { tenantId: session.tenantId, limit: 20 }).catch(() => []),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <BellRing className="h-6 w-6 text-primary" />
          Lembretes automáticos
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Envia email para o paciente antes da consulta. Reduz no-show em 10–20%.
        </p>
      </div>

      <ConfigForm initial={config} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Histórico de envios</h2>
        <p className="text-sm text-slate-500">
          Últimos 20 lembretes processados pelo motor. Clique em &quot;Reenviar&quot; para disparar
          uma nova tentativa.
        </p>
        <HistoryTable rows={history} />
      </section>
    </div>
  )
}
