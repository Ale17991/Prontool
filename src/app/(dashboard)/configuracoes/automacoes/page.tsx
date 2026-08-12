import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Wand2 } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { isWhatsAppConnected } from '@/lib/core/whatsapp/config'
import { listMessageTemplates, listTriggers } from '@/lib/core/automations/store'
import { buildSourceCatalog } from '@/lib/core/automations/catalog'
import { getAutomationMetrics, metricsVazio } from '@/lib/core/automations/metrics'
import { AutomacoesClient } from './automacoes-client'

export const dynamic = 'force-dynamic'

export default async function AutomacoesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'reminders.config')) redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (!ent.hasModule('automacoes')) redirect('/configuracoes')

  const svc = createSupabaseServiceClient() as unknown as SupabaseClient<Database>

  const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  const [mensagens, gatilhos, conectado, catalogo, metricas] = await Promise.all([
    listMessageTemplates(svc, session.tenantId).catch(() => []),
    listTriggers(svc, session.tenantId).catch(() => []),
    isWhatsAppConnected(svc, session.tenantId).catch(() => false),
    buildSourceCatalog(svc, session.tenantId, (m) => ent.hasModule(m as never)).catch(() => ({
      fontes: [],
      opcoes: { habit_items: [], metric_types: [] },
    })),
    getAutomationMetrics(svc, session.tenantId, desde).catch(() => new Map()),
  ])

  const { data } = await svc
    .from('automations')
    .select(
      `id, active, automation_triggers!inner(id, name, source), message_templates!inner(id, name)`,
    )
    .eq('tenant_id', session.tenantId)
    .order('created_at', { ascending: true })

  const automacoes = (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string
      active: boolean
      automation_triggers: { id: string; name: string; source: string }
      message_templates: { id: string; name: string }
    }
    const m = metricas.get(row.id) ?? metricsVazio()
    return {
      id: row.id,
      active: row.active,
      gatilhoNome: row.automation_triggers.name,
      mensagemNome: row.message_templates.name,
      enviados30d: m.enviados,
      entregues30d: m.entregues,
      lidos30d: m.lidos,
      suprimidos30d: m.suprimidos,
    }
  })

  // O rótulo da fonte vem do catálogo, não de um mapa nesta página: gatilho
  // criado com uma fonte que depois deixou de estar disponível (módulo
  // revogado) precisa continuar identificável na lista.
  const rotuloDaFonte = new Map(catalogo.fontes.map((f) => [f.id, f.label]))
  const gatilhosComRotulo = gatilhos.map((g) => ({
    id: g.id,
    name: g.name,
    source: g.source,
    fonteLabel: rotuloDaFonte.get(g.source) ?? g.source,
  }))

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-start gap-3">
        <Wand2 className="mt-1 h-6 w-6 text-primary" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold">Automações de mensagem</h1>
          <p className="text-sm text-muted-foreground">
            Escolha <strong>quando</strong> (o gatilho) e <strong>o que</strong> (a mensagem). As
            duas coisas são separadas: a mesma mensagem serve vários gatilhos.
          </p>
        </div>
      </header>

      {!conectado && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          O WhatsApp da clínica não está conectado. As automações podem ser montadas, mas nada será
          enviado até o número ser vinculado em Configurações → Lembretes.
        </div>
      )}

      {/* O consentimento de automação nasce DESLIGADO por paciente (é conteúdo
          não solicitado, finalidade distinta em LGPD do lembrete de consulta).
          Dizer isso aqui evita a conclusão errada de que a automação quebrou
          quando, na verdade, ninguém consentiu ainda. */}
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        Mensagem de automação exige consentimento <strong>próprio</strong> do paciente, separado do
        lembrete de consulta — e ele começa desligado para todo mundo. A chave fica na ficha de cada
        paciente, junto dos outros consentimentos.
      </div>

      {/* Lembrete de consulta mora em outra tela, e dizer isso aqui é o FR-026:
          enquanto os dois motores coexistirem, quem procurar o lembrete aqui
          precisa ser mandado para o lugar certo em vez de concluir que sumiu. */}
      <p className="text-sm text-muted-foreground">
        Procurando o lembrete de consulta? Ele fica em{' '}
        <a className="underline" href="/configuracoes/lembretes">
          Configurações → Lembretes
        </a>
        , com configuração própria.
      </p>

      <AutomacoesClient
        automacoesIniciais={automacoes}
        mensagensIniciais={mensagens}
        gatilhosIniciais={gatilhosComRotulo}
        fontes={catalogo.fontes}
        opcoes={catalogo.opcoes}
      />
    </div>
  )
}
