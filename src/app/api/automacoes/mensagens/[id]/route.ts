/**
 * Feature 056 — mensagem individual. PATCH edita, DELETE exclui.
 *
 * A exclusão é RECUSADA quando há automação dependente, e a recusa nomeia os
 * gatilhos (FR-004).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { deleteMessageTemplate, updateMessageTemplate } from '@/lib/core/automations/store'
import { auditAutomation } from '@/lib/core/automations/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1).max(1000).optional(),
  active: z.boolean().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/automacoes/mensagens/${params.id}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'message_templates',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const parsed = patchSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 })

    const supabase = createSupabaseServiceClient()
    try {
      await updateMessageTemplate(supabase, session.tenantId, params.id, parsed.data)
    } catch (e) {
      if (e instanceof Error && e.message === 'NOME_DUPLICADO') {
        return NextResponse.json({ error: 'NOME_DUPLICADO' }, { status: 409 })
      }
      throw e
    }

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'message_templates',
      entityId: params.id,
      field: Object.keys(parsed.data).join(','),
      reason: 'Mensagem de automação editada',
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/automacoes/mensagens/${params.id}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'message_templates',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const supabase = createSupabaseServiceClient()
    try {
      await deleteMessageTemplate(supabase, session.tenantId, params.id)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('MENSAGEM_EM_USO')) {
        const nomes = e.message.slice('MENSAGEM_EM_USO:'.length)
        return NextResponse.json(
          { error: 'MENSAGEM_EM_USO', detail: `Em uso por: ${nomes}` },
          { status: 409 },
        )
      }
      throw e
    }

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'message_templates',
      entityId: params.id,
      field: 'deleted',
      reason: 'Mensagem de automação excluída',
    })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
