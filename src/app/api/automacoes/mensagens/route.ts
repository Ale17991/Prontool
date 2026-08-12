/**
 * Feature 056 — catálogo de mensagens. GET lista, POST cria.
 *
 * Admin-only (FR-022): montar automação decide quem recebe mensagem e qual —
 * é decisão administrativa, não operacional.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { createMessageTemplate, listMessageTemplates } from '@/lib/core/automations/store'
import { auditAutomation } from '@/lib/core/automations/audit'
import { extractVariables } from '@/lib/core/automations/render'
import { listSources } from '@/lib/core/automations/sources'
import { UNIVERSAL_VARIABLES } from '@/lib/core/automations/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(1000),
})

/**
 * Uma variável só é aceitável se ALGUMA fonte souber preenchê-la — senão a
 * mensagem nasce impossível de usar. A checagem estrita (esta mensagem serve
 * ESTE gatilho?) acontece depois, ao associar.
 */
function unknownVariables(body: string): string[] {
  const conhecidas = new Set<string>(UNIVERSAL_VARIABLES)
  for (const s of listSources()) for (const v of s.variables) conhecidas.add(v)
  return extractVariables(body).filter((v) => !conhecidas.has(v))
}

export async function GET(req: Request): Promise<Response> {
  const route = '/api/automacoes/mensagens'
  try {
    const session = await requireRole(['admin'], { entity: 'message_templates', route, request: req })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const mensagens = await listMessageTemplates(createSupabaseServiceClient(), session.tenantId)
    return NextResponse.json({ mensagens }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/automacoes/mensagens'
  try {
    const session = await requireRole(['admin'], { entity: 'message_templates', route, request: req })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 })
    }

    const desconhecidas = unknownVariables(parsed.data.body)
    if (desconhecidas.length > 0) {
      return NextResponse.json(
        {
          error: 'VARIAVEL_DESCONHECIDA',
          detail: `${desconhecidas.map((v) => `{{${v}}}`).join(', ')} não é uma variável válida`,
        },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    let id: string
    try {
      id = await createMessageTemplate(supabase, {
        tenantId: session.tenantId,
        name: parsed.data.name,
        body: parsed.data.body,
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
      entity: 'message_templates',
      entityId: id,
      field: 'created',
      newValue: parsed.data.name,
      reason: 'Mensagem de automação criada',
    })

    return NextResponse.json({ id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
