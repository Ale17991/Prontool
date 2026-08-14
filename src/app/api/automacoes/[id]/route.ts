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
import {
  deleteAutomation,
  setAutomationActive,
  updateAutomation,
} from '@/lib/core/automations/store'
import { auditAutomation } from '@/lib/core/automations/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z
  .object({
    active: z.boolean().optional(),
    name: z.string().trim().min(1).max(80).optional(),
    sendAtLocal: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'horário deve ser HH:MM')
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nada a alterar' })

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

    if (parsed.data.name !== undefined || parsed.data.sendAtLocal !== undefined) {
      try {
        await updateAutomation(supabase, session.tenantId, params.id, {
          name: parsed.data.name,
          sendAtLocal: parsed.data.sendAtLocal,
        })
      } catch (e) {
        if (e instanceof Error && e.message === 'NOME_DUPLICADO') {
          return NextResponse.json({ error: 'NOME_DUPLICADO' }, { status: 409 })
        }
        throw e
      }
    }

    if (parsed.data.active !== undefined) {
      await setAutomationActive(supabase, session.tenantId, params.id, parsed.data.active)
    }

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'automations',
      entityId: params.id,
      field: Object.keys(parsed.data).join(','),
      newValue:
        parsed.data.active !== undefined ? String(parsed.data.active) : (parsed.data.name ?? parsed.data.sendAtLocal),
      reason:
        parsed.data.active === undefined
          ? 'Automação editada'
          : parsed.data.active
            ? 'Automação ativada'
            : 'Automação desativada',
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
    try {
      await deleteAutomation(supabase, session.tenantId, params.id)
    } catch (e) {
      if (e instanceof Error && e.message === 'JA_ENVIOU') {
        return NextResponse.json(
          {
            error: 'JA_ENVIOU',
            detail:
              'Esta automação já enviou mensagens, e o registro de quem recebeu o quê não pode ser apagado. Desligue-a para parar os envios — ela deixa de disparar imediatamente.',
          },
          { status: 409 },
        )
      }
      throw e
    }

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
