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
import {
  resolveTrigger,
  sendAtLocalFor,
  validarMensagemParaFonte,
} from '@/lib/core/automations/compose'
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

    // Resolve o gatilho: a partir de um id existente (compatibilidade e testes
    // de contrato) ou de fonte+parâmetros no mesmo pedido. As regras vivem em
    // `compose.ts` porque a EDIÇÃO precisa exatamente das mesmas.
    const r = await resolveTrigger(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      triggerId: parsed.data.triggerId,
      source: parsed.data.source,
      params: parsed.data.params,
    })
    if ('erro' in r) {
      return NextResponse.json(
        { error: r.erro.code, detail: 'detail' in r.erro ? r.erro.detail : undefined },
        { status: r.erro.status },
      )
    }
    const { triggerId, source, params: paramsValidados, nomeDerivado, ancorada } = r.ok

    const v = await validarMensagemParaFonte(supabase, {
      tenantId: session.tenantId,
      messageTemplateId: parsed.data.messageTemplateId,
      source,
    })
    if ('erro' in v) {
      return NextResponse.json(
        { error: v.erro.code, detail: 'detail' in v.erro ? v.erro.detail : undefined },
        { status: v.erro.status },
      )
    }

    // O nome é da clínica quando ela deu um; senão, o do gatilho derivado. A
    // coluna é NOT NULL, e "Automação 1" seria pior que a descrição da fonte.
    const nome = parsed.data.name ?? nomeDerivado

    // Horário de disparo não vale para fonte ancorada — "2 horas antes da
    // consulta, às 14:30" é contradição. Grava o padrão em vez de aceitar um
    // valor que o motor ignoraria: guardar o que não vale faria a tela mostrar
    // um horário que nunca acontece.
    const sendAtLocal = sendAtLocalFor(ancorada, parsed.data.sendAtLocal)

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
      newValue: `${nome} (${source} → ${v.nomeMensagem})`,
      reason: 'Automação criada',
    })

    return NextResponse.json({ id, active: false }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
