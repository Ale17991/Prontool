import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BellRing, Wand2 } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { isWhatsAppConnected } from '@/lib/core/whatsapp/config'
import { listMessageTemplates } from '@/lib/core/automations/store'
import { buildSourceCatalog } from '@/lib/core/automations/catalog'
import { getSource } from '@/lib/core/automations/sources'
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
  const [mensagens, conectado, catalogo, metricas] = await Promise.all([
    listMessageTemplates(svc, session.tenantId).catch(() => []),
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
      `id, active, name, send_at_local,
       automation_triggers!inner(id, name, source, params),
       message_templates!inner(id, name)`,
    )
    .eq('tenant_id', session.tenantId)
    .order('created_at', { ascending: true })

  const automacoes = (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string
      active: boolean
      name: string | null
      send_at_local: string | null
      automation_triggers: {
        id: string
        name: string
        source: string
        params: Record<string, unknown> | null
      }
      message_templates: { id: string; name: string }
    }
    const m = metricas.get(row.id) ?? metricsVazio()
    // O rótulo da fonte sai do REGISTRO, e não do catálogo desta página: o
    // catálogo esconde as fontes de módulo não contratado, e uma automação
    // criada antes de o módulo ser revogado precisa continuar identificável na
    // lista — senão a clínica vê uma linha que não sabe o que faz e não pode
    // desligar com confiança.
    const fonte = getSource(row.automation_triggers.source)
    return {
      id: row.id,
      active: row.active,
      nome: row.name ?? row.automation_triggers.name,
      fonteLabel: fonte?.label ?? row.automation_triggers.source,
      mensagemNome: row.message_templates.name,
      horario: (row.send_at_local ?? '09:00').slice(0, 5),
      ancorada: Boolean(fonte?.isAnchored?.(row.automation_triggers.params ?? {})),
      enviados30d: m.enviados,
      entregues30d: m.entregues,
      lidos30d: m.lidos,
      suprimidos30d: m.suprimidos,
    }
  })

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-start gap-3">
        <Wand2 className="mt-1 h-6 w-6 text-primary" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold">Automações de mensagem</h1>
          <p className="text-sm text-muted-foreground">
            Escreva a <strong>mensagem</strong> e monte a automação: <strong>quando</strong> ela
            dispara e <strong>a que horas</strong> sai. A mesma mensagem serve várias automações.
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

      {/* O lembrete de consulta deixou de ter card próprio no hub e passou a
          entrar por AQUI. O motor continua separado (FR-024) — o que mudou foi
          só o caminho: são duas formas de mandar mensagem, e dois cards lado a
          lado obrigavam a clínica a adivinhar em qual delas estava o que
          procura. O destaque visual é deliberadamente menor que o do bloco de
          automações: é área secundária, não segunda tela principal.

          Esta tela também é o único lugar onde se conecta o número de WhatsApp,
          e é por isso que o texto diz isso em vez de só "lembretes". */}
      <a
        href="/configuracoes/lembretes"
        className="flex items-start gap-3 rounded-md border p-3 text-sm transition-colors hover:bg-muted/50"
      >
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          <strong className="font-medium">Lembretes de consulta</strong>
          <span className="block text-muted-foreground">
            Aviso automático antes do horário marcado, por WhatsApp ou e-mail — com regra própria,
            separada das automações. É também onde se conecta o número de WhatsApp da clínica.
          </span>
        </span>
      </a>

      <AutomacoesClient
        automacoesIniciais={automacoes}
        mensagensIniciais={mensagens}
        fontes={catalogo.fontes}
        opcoes={catalogo.opcoes}
      />
    </div>
  )
}
