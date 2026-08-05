import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BellRing, MessageCircle } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { getReminderConfig } from '@/lib/core/reminders/config'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { isWhatsAppConnected, getWhatsAppConnection } from '@/lib/core/whatsapp/config'
import { resolveDeliveryStatuses } from '@/lib/core/whatsapp/delivery'
import { getWhatsAppReadRate } from '@/lib/core/whatsapp/metrics'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listRemindersHistory } from '@/lib/core/reminders/history'
import { ConfigForm } from './config-form'
import { HistoryTable } from './history-table'
import { ConnectionPanel } from './whatsapp-panel'

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

  // Conectar o número mora AQUI, e não em tela própria: vincular o WhatsApp só
  // existe para servir o lembrete, e separar as duas coisas fazia a clínica
  // configurar o canal numa tela e descobrir na outra que faltava conectar.
  //
  // O RBAC continua sendo o de conexão, que é DELIBERADAMENTE mais restrito que
  // o da tela (FR-024): recepção configura lembrete, mas vincular o número é
  // ato de titularidade da clínica — o risco de bloqueio é do número dela.
  const podeConectar = can(session.role, 'whatsapp.config') && ent.hasModule('whatsapp')
  const connection = podeConectar
    ? await getWhatsAppConnection(svc, session.tenantId).catch(() => null)
    : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <BellRing className="h-6 w-6 text-primary" />
          Lembretes automáticos
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Avisa o paciente antes da consulta, por email ou WhatsApp. Reduz no-show em 10–20%.
        </p>
      </div>

      {podeConectar && (
        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <MessageCircle className="h-5 w-5 text-primary" />
              Número de WhatsApp
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Vincule o WhatsApp da clínica para poder usar esse canal. O número fica conectado como
              um aparelho a mais — o celular precisa continuar ligado e com internet.
            </p>
          </div>

          <ConnectionPanel initial={connection} />

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Antes de conectar</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              <li>
                • Use o número <strong>da clínica</strong>, não o pessoal de alguém. Ele fica
                vinculado ao sistema.
              </li>
              <li>
                • Prefira um número <strong>com histórico de conversas reais</strong>. Chip novo
                disparando mensagem em série é o perfil que o WhatsApp mais bloqueia.
              </li>
              <li>
                • O celular precisa ficar ligado e com internet. Se a sessão cair, os lembretes
                param até você reconectar.
              </li>
            </ul>
          </div>
        </section>
      )}

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
