import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BellRing } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { getReminderConfig } from '@/lib/core/reminders/config'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { isWhatsAppConnected } from '@/lib/core/whatsapp/config'
import { resolveDeliveryStatuses } from '@/lib/core/whatsapp/delivery'
import { getWhatsAppReadRate } from '@/lib/core/whatsapp/metrics'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listRemindersHistory } from '@/lib/core/reminders/history'
import { ConfigForm } from './config-form'
import { HistoryTable } from './history-table'

export const dynamic = 'force-dynamic'

export default async function LembretesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'reminders.config')) redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  // `tenant_whatsapp_config` não é projetada para usuário autenticado — a
  // leitura do estado da conexão usa service-role, com tenant explícito.
  const svc = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
  const [config, history, ent, whatsappConnected] = await Promise.all([
    getReminderConfig(supabase, session.tenantId),
    listRemindersHistory(supabase, { tenantId: session.tenantId, limit: 20 }).catch(() => []),
    getTenantEntitlements(supabase, session.tenantId),
    isWhatsAppConnected(svc, session.tenantId).catch(() => false),
  ])

  // Um SELECT só para o histórico inteiro — a resolução por precedência é
  // feita em memória, não com N+1.
  const entregas = Object.fromEntries(
    await resolveDeliveryStatuses(
      svc,
      session.tenantId,
      history.filter((h) => h.channel === 'whatsapp').map((h) => h.id),
    ).catch(() => new Map<string, string>()),
  )

  // SC-004 nos últimos 30 dias. Só faz sentido para quem tem o canal; para as
  // demais clínicas seria um bloco vazio pedindo explicação.
  const agora = new Date()
  const leitura = ent.hasModule('whatsapp')
    ? await getWhatsAppReadRate(svc, session.tenantId, {
        since: new Date(agora.getTime() - 30 * 24 * 3600_000).toISOString(),
        until: agora.toISOString(),
      }).catch(() => null)
    : null

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

      <ConfigForm
        initial={config}
        whatsappConnected={whatsappConnected}
        whatsappModuleEnabled={ent.hasModule('whatsapp')}
      />

      {leitura && leitura.taxa !== null && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Leitura no WhatsApp</h2>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">
            {Math.round(leitura.taxa * 100)}%
            <span className="ml-2 align-middle text-sm font-medium text-slate-500">
              dos {leitura.entregues} lembretes entregues foram lidos em até 24h
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Últimos 30 dias.
            {leitura.lidosDepois > 0 && ` Outros ${leitura.lidosDepois} foram lidos depois disso.`}
            {leitura.enviadosSemEntrega > 0 &&
              ` ${leitura.enviadosSemEntrega} sairam sem confirmação de entrega.`}
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Histórico de envios</h2>
        <p className="text-sm text-slate-500">
          Últimos 20 lembretes processados pelo motor. Clique em &quot;Reenviar&quot; para disparar
          uma nova tentativa.
        </p>
        <HistoryTable rows={history} entregas={entregas} />
      </section>
    </div>
  )
}
