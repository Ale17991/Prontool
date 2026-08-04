/**
 * Feature 053 — PATCH/DELETE /api/notificacoes-automaticas/[id]
 *
 * DELETE **desativa**, não apaga: `signal_occurrences` referencia a regra, e
 * apagar deixaria o histórico órfão — a clínica perderia a explicação de
 * mensagens que o paciente recebeu de verdade.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { requireRole } from '@/lib/auth/require-role'
import { ForbiddenError, UnauthorizedError } from '@/lib/observability/errors'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { familyById } from '@/lib/core/signals/catalog'
import { deactivateRule, listRules, updateRule, validateRule } from '@/lib/core/signals/rules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROLES = ['admin', 'recepcionista'] as const

const patchShape = z.object({
  params: z.record(z.unknown()).optional(),
  audience: z.enum(['todos_ativos', 'por_profissional']).optional(),
  audienceDoctorId: z.string().uuid().nullable().optional(),
  channel: z.enum(['whatsapp', 'email', 'preferencial']).optional(),
  messageTemplate: z.string().min(1).optional(),
  silenceDays: z.number().int().optional(),
  active: z.boolean().optional(),
})

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  const ruleId = context.params.id
  const auth = await autorizar(request, ruleId)
  if ('response' in auth) return auth.response

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const ent = await getTenantEntitlements(supabase, auth.session.tenantId)
  if (!ent.hasModule('acompanhamento')) {
    return NextResponse.json({ error: 'MODULE_DISABLED' }, { status: 403 })
  }

  const parsed = patchShape.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })

  const atual = (await listRules(supabase, auth.session.tenantId)).find((r) => r.id === ruleId)
  if (!atual) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // Valida o estado RESULTANTE, não só o que veio no corpo: alterar só o texto
  // ainda precisa ser conferido contra os placeholders da família original.
  const familia = familyById(atual.family)
  if (!familia) return NextResponse.json({ error: 'UNKNOWN_FAMILY' }, { status: 400 })

  const resultante = {
    family: atual.family,
    params: parsed.data.params ?? atual.params,
    audience: parsed.data.audience ?? atual.audience,
    audienceDoctorId:
      parsed.data.audienceDoctorId !== undefined
        ? parsed.data.audienceDoctorId
        : atual.audienceDoctorId,
    channel: parsed.data.channel ?? atual.channel,
    messageTemplate: parsed.data.messageTemplate ?? atual.messageTemplate,
    silenceDays: parsed.data.silenceDays ?? atual.silenceDays,
  }
  const erro = validateRule(resultante)
  if (erro) return NextResponse.json(erro, { status: 400 })

  const rule = await updateRule(supabase, auth.session.tenantId, ruleId, {
    ...resultante,
    active: parsed.data.active,
  })
  if (!rule) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true, rule })
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  const ruleId = context.params.id
  const auth = await autorizar(request, ruleId)
  if ('response' in auth) return auth.response

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const ent = await getTenantEntitlements(supabase, auth.session.tenantId)
  if (!ent.hasModule('acompanhamento')) {
    return NextResponse.json({ error: 'MODULE_DISABLED' }, { status: 403 })
  }

  const ok = await deactivateRule(supabase, auth.session.tenantId, ruleId)
  if (!ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

async function autorizar(request: NextRequest, ruleId: string) {
  try {
    const session = await requireRole([...ROLES], {
      entity: 'signal_rules',
      entityId: ruleId,
      route: `/api/notificacoes-automaticas/${ruleId}`,
      request,
    })
    return { session }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) }
    }
    if (err instanceof ForbiddenError) {
      return { response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) }
    }
    throw err
  }
}
