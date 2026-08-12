/**
 * Feature 056 — gatilho individual. PATCH edita, DELETE exclui.
 *
 * Excluir gatilho leva junto as automações que o usam (CASCADE), diferente da
 * mensagem, cuja exclusão é recusada. A assimetria é proposital: o gatilho É a
 * automação do ponto de vista da clínica; a mensagem é insumo compartilhado.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { deleteTrigger, listTriggers, updateTrigger } from '@/lib/core/automations/store'
import { auditAutomation } from '@/lib/core/automations/audit'
import { getSource } from '@/lib/core/automations/sources'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  params: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
})

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/automacoes/gatilhos/${params.id}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'automation_triggers',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const parsed = patchSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 })

    const supabase = createSupabaseServiceClient()

    // Trocar parâmetros revalida pelo schema da fonte — o gatilho já existe,
    // mas os novos valores precisam continuar fazendo sentido para ela.
    let payload = parsed.data
    if (parsed.data.params) {
      const atual = (await listTriggers(supabase, session.tenantId)).find((g) => g.id === params.id)
      const fonte = atual ? getSource(atual.source) : null
      if (!fonte) return NextResponse.json({ error: 'FONTE_DESCONHECIDA' }, { status: 400 })
      const v = fonte.paramsSchema.safeParse(parsed.data.params)
      if (!v.success) {
        return NextResponse.json(
          { error: 'PARAMETROS_INVALIDOS', detail: v.error.issues[0]?.message ?? 'inválido' },
          { status: 400 },
        )
      }
      payload = { ...parsed.data, params: v.data as Record<string, unknown> }
    }

    await updateTrigger(supabase, session.tenantId, params.id, payload)

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'automation_triggers',
      entityId: params.id,
      field: Object.keys(parsed.data).join(','),
      reason: 'Gatilho de automação editado',
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/automacoes/gatilhos/${params.id}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'automation_triggers',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const supabase = createSupabaseServiceClient()
    await deleteTrigger(supabase, session.tenantId, params.id)

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'automation_triggers',
      entityId: params.id,
      field: 'deleted',
      reason: 'Gatilho de automação excluído',
    })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
