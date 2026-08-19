/**
 * Feature 056 — editar, ativar e desativar a automação.
 *
 * Ativar é a operação mais consequente da feature: ligar decide que mensagens
 * passam a sair sozinhas. Por isso é auditada com ator e valor (FR-018).
 *
 * A EDIÇÃO nasceu depois. Antes, mudar qualquer coisa numa automação existente
 * significava apagar e recriar — e apagar leva junto as ocorrências (CASCADE na
 * 0196), ou seja, o histórico de quem já recebeu. Quem só queria corrigir a
 * hora perdia a memória de quem já tinha sido avisado, e a automação recriada
 * mandava tudo de novo.
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
import {
  resolveTrigger,
  sendAtLocalFor,
  validarMensagemParaFonte,
} from '@/lib/core/automations/compose'

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
    messageTemplateId: z.string().uuid().optional(),
    /** Trocar o "quando": resolve para OUTRO gatilho, nunca edita o atual. */
    source: z.string().trim().min(1).max(60).optional(),
    params: z.record(z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nada a alterar' })

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
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

    // Trocar o "quando" resolve para outro gatilho (novo ou já existente) e
    // REAPONTA esta automação. O gatilho antigo fica de pé: outras automações
    // podem compartilhá-lo, e editá-lo no lugar mudaria a hora delas em
    // silêncio — ver `resolveTrigger`.
    let triggerId: string | undefined
    let source: string | undefined
    let ancorada = false
    if (parsed.data.source !== undefined) {
      const r = await resolveTrigger(supabase, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        source: parsed.data.source,
        params: parsed.data.params,
      })
      if ('erro' in r) {
        return NextResponse.json(
          { error: r.erro.code, detail: 'detail' in r.erro ? r.erro.detail : undefined },
          { status: r.erro.status },
        )
      }
      triggerId = r.ok.triggerId
      source = r.ok.source
      ancorada = r.ok.ancorada
    }

    // A mensagem é conferida contra a fonte que VAI VALER depois desta edição,
    // não contra a que valia antes: trocar o gatilho para um que não fornece a
    // variável usada no texto deixaria a automação gravada e muda.
    if (parsed.data.messageTemplateId !== undefined || source !== undefined) {
      const alvoSource = source ?? (await sourceAtual(supabase, session.tenantId, params.id))
      const alvoMsg =
        parsed.data.messageTemplateId ??
        (await mensagemAtual(supabase, session.tenantId, params.id))
      if (alvoSource && alvoMsg) {
        const v = await validarMensagemParaFonte(supabase, {
          tenantId: session.tenantId,
          messageTemplateId: alvoMsg,
          source: alvoSource,
        })
        if ('erro' in v) {
          return NextResponse.json(
            { error: v.erro.code, detail: 'detail' in v.erro ? v.erro.detail : undefined },
            { status: v.erro.status },
          )
        }
      }
    }

    const mudouAlgo =
      parsed.data.name !== undefined ||
      parsed.data.sendAtLocal !== undefined ||
      parsed.data.messageTemplateId !== undefined ||
      triggerId !== undefined

    if (mudouAlgo) {
      try {
        await updateAutomation(supabase, session.tenantId, params.id, {
          name: parsed.data.name,
          sendAtLocal: sendAtLocalFor(ancorada, parsed.data.sendAtLocal),
          messageTemplateId: parsed.data.messageTemplateId,
          triggerId,
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
        parsed.data.active !== undefined
          ? String(parsed.data.active)
          : (parsed.data.name ?? parsed.data.sendAtLocal),
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
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
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

/** Fonte do gatilho atual — para validar a mensagem contra o que vai valer. */
async function sourceAtual(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  id: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('automations')
    .select('automation_triggers(source)')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  const t = (data as { automation_triggers?: { source?: string } | null } | null)
    ?.automation_triggers
  return t?.source ?? null
}

async function mensagemAtual(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  id: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('automations')
    .select('message_template_id')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  return (data as { message_template_id?: string } | null)?.message_template_id ?? null
}
