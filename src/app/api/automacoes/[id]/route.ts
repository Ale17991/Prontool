/**
 * Feature 056 — ativar e desativar a automação.
 *
 * É a operação mais consequente da feature: ligar decide que mensagens passam
 * a sair sozinhas. Por isso é auditada com ator e valor (FR-018).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { deleteAutomation, setAutomationActive } from '@/lib/core/automations/store'
import { auditAutomation } from '@/lib/core/automations/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({ active: z.boolean() })

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/automacoes/${params.id}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'automations',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const parsed = patchSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 })

    const supabase = createSupabaseServiceClient()
    await setAutomationActive(supabase, session.tenantId, params.id, parsed.data.active)

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'automations',
      entityId: params.id,
      field: 'active',
      newValue: String(parsed.data.active),
      reason: parsed.data.active ? 'Automação ativada' : 'Automação desativada',
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

/**
 * Desfaz o vínculo entre gatilho e mensagem.
 *
 * O gatilho e a mensagem SOBREVIVEM — só a associação morre. É a operação que
 * permite trocar a mensagem de um gatilho sem recriar o gatilho (FR-003), e a
 * razão de a automação ser entidade própria em vez de uma coluna no gatilho.
 *
 * As ocorrências caem junto (CASCADE na 0196), e isso é deliberado: elas
 * descrevem envios daquela dupla específica, e mantê-las órfãs produziria um
 * histórico que não dá para explicar. A trilha de quem desligou o quê, quando e
 * por quê fica na auditoria, que não cai.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/automacoes/${params.id}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'automations',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const supabase = createSupabaseServiceClient()
    await deleteAutomation(supabase, session.tenantId, params.id)

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'automations',
      entityId: params.id,
      field: 'deleted',
      reason: 'Automação excluída',
    })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
