/**
 * Feature 056 — gatilhos. GET lista (e devolve o catálogo de fontes), POST cria.
 *
 * O catálogo vem do registro, não da tela: rótulo, schema de parâmetros e os
 * AVISOS de cada fonte — inclusive o do FR-009, que é obrigação da fonte de
 * ausência declarar que o dado disponível é "não marcou".
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { createTrigger, listTriggers } from '@/lib/core/automations/store'
import { auditAutomation } from '@/lib/core/automations/audit'
import { getSource } from '@/lib/core/automations/sources'
import { buildSourceCatalog } from '@/lib/core/automations/catalog'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(60),
  params: z.record(z.unknown()).default({}),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/automacoes/gatilhos'
  try {
    const session = await requireRole(['admin'], {
      entity: 'automation_triggers',
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const supabase = createSupabaseServiceClient()
    const ent = await getTenantEntitlements(supabase, session.tenantId)
    const [gatilhos, catalogo] = await Promise.all([
      listTriggers(supabase, session.tenantId),
      buildSourceCatalog(supabase, session.tenantId, (m) => ent.hasModule(m as never)),
    ])
    return NextResponse.json(
      { gatilhos, fontes: catalogo.fontes, opcoes: catalogo.opcoes },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/automacoes/gatilhos'
  try {
    const session = await requireRole(['admin'], {
      entity: 'automation_triggers',
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 })

    const fonte = getSource(parsed.data.source)
    if (!fonte) return NextResponse.json({ error: 'FONTE_DESCONHECIDA' }, { status: 400 })

    // O módulo da fonte é conferido no SERVIDOR, não só escondendo a opção da
    // lista: a rota é chamável direto, e a fonte de vertical lê tabela de
    // vertical. Esconder na tela é conveniência; recusar aqui é o controle.
    if (fonte.requiresModule) {
      const ent = await getTenantEntitlements(createSupabaseServiceClient(), session.tenantId)
      if (!ent.hasModule(fonte.requiresModule as never)) {
        return NextResponse.json({ error: 'FONTE_INDISPONIVEL' }, { status: 403 })
      }
    }

    // Os parâmetros são validados pelo schema DA FONTE — o registro é quem
    // sabe o que cada uma aceita.
    const params = fonte.paramsSchema.safeParse(parsed.data.params)
    if (!params.success) {
      return NextResponse.json(
        { error: 'PARAMETROS_INVALIDOS', detail: params.error.issues[0]?.message ?? 'inválido' },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    let id: string
    try {
      id = await createTrigger(supabase, {
        tenantId: session.tenantId,
        name: parsed.data.name,
        source: parsed.data.source,
        params: params.data as Record<string, unknown>,
        actorUserId: session.userId,
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'NOME_DUPLICADO') {
        return NextResponse.json({ error: 'NOME_DUPLICADO' }, { status: 409 })
      }
      throw e
    }

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'automation_triggers',
      entityId: id,
      field: 'created',
      newValue: `${parsed.data.name} (${parsed.data.source})`,
      reason: 'Gatilho de automação criado',
    })

    return NextResponse.json({ id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
