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
import { createAutomation, findOrCreateTrigger, listTriggers } from '@/lib/core/automations/store'
import { auditAutomation } from '@/lib/core/automations/audit'
import { describeTrigger } from '@/lib/core/automations/describe'
import { getSource } from '@/lib/core/automations/sources'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { variablesNotProvidedBy } from '@/lib/core/automations/render'
import {
  getAutomationMetrics,
  metricsVazio,
  type AutomationMetrics,
} from '@/lib/core/automations/metrics'
import { UNIVERSAL_VARIABLES } from '@/lib/core/automations/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * A automação é criada em UM ato: nome, mensagem e o "quando" completo.
 *
 * O gatilho continua existindo como linha, mas a clínica não o cria mais: ele
 * nasce aqui, com nome derivado, e é reaproveitado quando já houver um idêntico.
 * Pedir que a clínica criasse gatilho, depois mensagem, e só então ligasse os
 * dois era pedir três atos para uma ideia só — e o nome estava no objeto errado,
 * porque quem a clínica procura e desliga é a automação.
 *
 * `triggerId` continua aceito para quem já tem um gatilho gravado (e para os
 * testes de contrato que montam o vínculo direto). Um dos dois caminhos, nunca
 * os dois.
 */
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    messageTemplateId: z.string().uuid(),
    sendAtLocal: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'horário deve ser HH:MM')
      .optional(),
    triggerId: z.string().uuid().optional(),
    source: z.string().trim().min(1).max(60).optional(),
    params: z.record(z.unknown()).optional(),
  })
  .refine((v) => Boolean(v.triggerId) !== Boolean(v.source), {
    message: 'informe triggerId OU source',
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
        `id, active, activated_at, name, send_at_local,
         automation_triggers!inner(id, name, source, params),
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
      const fonte = getSource(row.automation_triggers.source)
      const params = row.automation_triggers.params ?? {}
      return {
        id: row.id,
        active: row.active,
        activatedAt: row.activated_at,
        nome: row.name ?? row.automation_triggers.name,
        // `TIME` volta como `09:00:00`; a tela desenha `HH:MM`.
        horario: (row.send_at_local ?? '09:00').slice(0, 5),
        fonteLabel: fonte?.label ?? row.automation_triggers.source,
        // Quem é ancorada não tem horário do dia para mostrar — o instante vem
        // da consulta de cada paciente, e exibir "09:00" ali seria mentira.
        ancorada: Boolean(fonte?.isAnchored?.(params)),
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

    // Caminho 1 — gatilho já existente (compatibilidade e testes de contrato).
    // Caminho 2 — a fonte e os parâmetros vieram no mesmo pedido, e o gatilho é
    // criado (ou reaproveitado) por baixo.
    let triggerId: string
    let source: string
    let paramsValidados: Record<string, unknown>

    if (parsed.data.triggerId) {
      const gatilho = (await listTriggers(supabase, session.tenantId)).find(
        (g) => g.id === parsed.data.triggerId,
      )
      if (!gatilho) return NextResponse.json({ error: 'GATILHO_NAO_ENCONTRADO' }, { status: 404 })
      triggerId = gatilho.id
      source = gatilho.source
      paramsValidados = gatilho.params ?? {}
    } else {
      source = parsed.data.source as string
      const f = getSource(source)
      if (!f) return NextResponse.json({ error: 'FONTE_DESCONHECIDA' }, { status: 400 })

      // O módulo da fonte é conferido no SERVIDOR, não só escondendo a opção da
      // lista: a rota é chamável direto, e a fonte de vertical lê tabela de
      // vertical. Esconder na tela é conveniência; recusar aqui é o controle.
      if (f.requiresModule) {
        const ent = await getTenantEntitlements(supabase, session.tenantId)
        if (!ent.hasModule(f.requiresModule as never)) {
          return NextResponse.json({ error: 'FONTE_INDISPONIVEL' }, { status: 403 })
        }
      }

      const v = f.paramsSchema.safeParse(parsed.data.params ?? {})
      if (!v.success) {
        return NextResponse.json(
          { error: 'PARAMETROS_INVALIDOS', detail: v.error.issues[0]?.message ?? 'inválido' },
          { status: 400 },
        )
      }
      paramsValidados = v.data as Record<string, unknown>

      triggerId = await findOrCreateTrigger(supabase, {
        tenantId: session.tenantId,
        nomeDerivado: describeTrigger(f, paramsValidados),
        source,
        params: paramsValidados,
        actorUserId: session.userId,
      })
    }

    const fonte = getSource(source)
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

    // O nome é da clínica quando ela deu um; senão, o do gatilho derivado. A
    // coluna é NOT NULL, e "Automação 1" seria pior que a descrição da fonte.
    const nome = parsed.data.name ?? describeTrigger(fonte, paramsValidados)

    // Horário de disparo não vale para fonte ancorada — "2 horas antes da
    // consulta, às 14:30" é contradição. Grava o padrão em vez de aceitar um
    // valor que o motor ignoraria: guardar o que não vale faria a tela mostrar
    // um horário que nunca acontece.
    const ancorada = Boolean(fonte.isAnchored?.(paramsValidados))
    const sendAtLocal = ancorada ? '09:00' : parsed.data.sendAtLocal

    let id: string
    try {
      id = await createAutomation(supabase, {
        tenantId: session.tenantId,
        name: nome,
        triggerId,
        messageTemplateId: parsed.data.messageTemplateId,
        sendAtLocal,
        actorUserId: session.userId,
      })
    } catch (e) {
      if (e instanceof Error && (e.message === 'JA_EXISTE' || e.message === 'NOME_DUPLICADO')) {
        return NextResponse.json({ error: e.message }, { status: 409 })
      }
      throw e
    }

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'automations',
      entityId: id,
      field: 'created',
      newValue: `${nome} (${source} → ${(msg as { name: string }).name})`,
      reason: 'Automação criada',
    })

    return NextResponse.json({ id, active: false }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
