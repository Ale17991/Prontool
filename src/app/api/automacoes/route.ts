/**
 * Feature 056 — automações. GET lista, POST associa gatilho a mensagem.
 *
 * A automação NASCE DESLIGADA. Ativar é ato consciente, depois de ver a prévia
 * de quantos pacientes serão atingidos — ligar uma automação de estado contínuo
 * numa base grande é o erro que mais custa caro aqui.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { createAutomation, listTriggers } from '@/lib/core/automations/store'
import { auditAutomation } from '@/lib/core/automations/audit'
import { getSource } from '@/lib/core/automations/sources'
import { variablesNotProvidedBy } from '@/lib/core/automations/render'
import {
  getAutomationMetrics,
  metricsVazio,
  type AutomationMetrics,
} from '@/lib/core/automations/metrics'
import { UNIVERSAL_VARIABLES } from '@/lib/core/automations/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  triggerId: z.string().uuid(),
  messageTemplateId: z.string().uuid(),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/automacoes'
  try {
    const session = await requireRole(['admin'], { entity: 'automations', route, request: req })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('automations')
      .select(
        `id, active, activated_at,
         automation_triggers!inner(id, name, source),
         message_templates!inner(id, name)`,
      )
      .eq('tenant_id', session.tenantId)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)

    // As contagens são DERIVADAS a cada leitura, nunca contador gravado: assim
    // corrigir a regra reapura o histórico (mesmo princípio do SC-004 da 051).
    const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    const metricas = await getAutomationMetrics(supabase, session.tenantId, desde).catch(
      () => new Map<string, AutomationMetrics>(),
    )

    const automacoes = (data ?? []).map((r) => {
      const row = r as unknown as {
        id: string
        active: boolean
        activated_at: string | null
        automation_triggers: { id: string; name: string; source: string }
        message_templates: { id: string; name: string }
      }
      const m = metricas.get(row.id) ?? metricsVazio()
      return {
        id: row.id,
        active: row.active,
        activatedAt: row.activated_at,
        gatilho: row.automation_triggers,
        mensagem: row.message_templates,
        enviados30d: m.enviados,
        entregues30d: m.entregues,
        lidos30d: m.lidos,
        suprimidos30d: m.suprimidos,
        impedidos30d: m.impedidos,
        falhas30d: m.falhas,
      }
    })

    return NextResponse.json({ automacoes }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/automacoes'
  try {
    const session = await requireRole(['admin'], { entity: 'automations', route, request: req })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 })

    const supabase = createSupabaseServiceClient()

    const gatilho = (await listTriggers(supabase, session.tenantId)).find(
      (g) => g.id === parsed.data.triggerId,
    )
    if (!gatilho) return NextResponse.json({ error: 'GATILHO_NAO_ENCONTRADO' }, { status: 404 })

    const fonte = getSource(gatilho.source)
    if (!fonte) return NextResponse.json({ error: 'FONTE_DESCONHECIDA' }, { status: 400 })

    const { data: msg } = await supabase
      .from('message_templates')
      .select('body, name')
      .eq('tenant_id', session.tenantId)
      .eq('id', parsed.data.messageTemplateId)
      .maybeSingle()
    if (!msg) return NextResponse.json({ error: 'MENSAGEM_NAO_ENCONTRADA' }, { status: 404 })

    // A validação que importa: esta mensagem pede alguma variável que ESTA
    // fonte não sabe preencher? O erro aparece aqui, para quem está montando —
    // não vira mensagem torta no celular do paciente três dias depois.
    const faltando = variablesNotProvidedBy((msg as { body: string }).body, [
      ...UNIVERSAL_VARIABLES,
      ...fonte.variables,
    ])
    if (faltando.length > 0) {
      return NextResponse.json(
        {
          error: 'VARIAVEL_NAO_FORNECIDA',
          detail: `A mensagem usa ${faltando
            .map((v) => `{{${v}}}`)
            .join(', ')}, que o gatilho "${fonte.label}" não fornece`,
        },
        { status: 400 },
      )
    }

    let id: string
    try {
      id = await createAutomation(supabase, {
        tenantId: session.tenantId,
        triggerId: parsed.data.triggerId,
        messageTemplateId: parsed.data.messageTemplateId,
        actorUserId: session.userId,
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'JA_EXISTE') {
        return NextResponse.json({ error: 'JA_EXISTE' }, { status: 409 })
      }
      throw e
    }

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'automations',
      entityId: id,
      field: 'created',
      newValue: `${gatilho.name} → ${(msg as { name: string }).name}`,
      reason: 'Automação criada',
    })

    return NextResponse.json({ id, active: false }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
