import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BellRing } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { getReminderConfig } from '@/lib/core/reminders/config'
import { ConfigForm } from './config-form'

export const dynamic = 'force-dynamic'

export default async function LembretesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'reminders.config')) redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const config = await getReminderConfig(supabase, session.tenantId)

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

      {/* Histórico vem em US3 (Phase 6). */}
    </div>
  )
}
