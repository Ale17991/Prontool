/**
 * Feature 053 — GET/POST /api/notificacoes-automaticas
 *
 * Catálogo das famílias disponíveis e as regras que a clínica ligou.
 *
 * O GET devolve também a contagem de consentimento. Não é enfeite: a base
 * existente nasce SEM `outreach_opt_in` (finalidade distinta da do lembrete de
 * consulta), então a clínica que liga a primeira regra e não vê mensagem
 * nenhuma sair concluiria que está quebrado. O número precisa estar na tela
 * antes de ela ligar qualquer coisa.
 *
 * RBAC: admin OU recepcionista (ambos têm `reminders.config`).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { requireRole } from '@/lib/auth/require-role'
import { ForbiddenError, UnauthorizedError } from '@/lib/observability/errors'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { implementedFamilies } from '@/lib/core/signals/catalog'
import { createRule, listRules, validateRule } from '@/lib/core/signals/rules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/notificacoes-automaticas'
const ROLES = ['admin', 'recepcionista'] as const

const createShape = z.object({
  family: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  audience: z.enum(['todos_ativos', 'por_profissional']).default('todos_ativos'),
  audienceDoctorId: z.string().uuid().nullable().optional(),
  channel: z.enum(['whatsapp', 'email', 'preferencial']).default('preferencial'),
  messageTemplate: z.string().min(1),
  silenceDays: z.number().int(),
})

export async function GET(request: NextRequest) {
  const auth = await autorizar(request)
  if ('response' in auth) return auth.response

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const ent = await getTenantEntitlements(supabase, auth.session.tenantId)
  if (!ent.hasModule('acompanhamento')) {
    return NextResponse.json({ error: 'MODULE_DISABLED' }, { status: 403 })
  }

  const [rules, consent] = await Promise.all([
    listRules(supabase, auth.session.tenantId),
    contagemDeAceite(supabase, auth.session.tenantId),
  ])

  return NextResponse.json({
    families: implementedFamilies().map((f) => ({
      id: f.id,
      nature: f.nature,
      label: f.label,
      description: f.description,
      placeholders: f.placeholders,
      defaultTemplate: f.defaultTemplate,
      defaultSilenceDays: f.defaultSilenceDays,
    })),
    rules,
    consent,
  })
}

export async function POST(request: NextRequest) {
  const auth = await autorizar(request)
  if ('response' in auth) return auth.response

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const ent = await getTenantEntitlements(supabase, auth.session.tenantId)
  if (!ent.hasModule('acompanhamento')) {
    return NextResponse.json({ error: 'MODULE_DISABLED' }, { status: 403 })
  }

  const parsed = createShape.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })

  const input = { ...parsed.data, audienceDoctorId: parsed.data.audienceDoctorId ?? null }
  const erro = validateRule(input)
  if (erro) return NextResponse.json(erro, { status: 400 })

  const rule = await createRule(supabase, auth.session.tenantId, input, auth.session.userId)
  return NextResponse.json({ ok: true, rule }, { status: 201 })
}

async function autorizar(request: NextRequest) {
  try {
    const session = await requireRole([...ROLES], {
      entity: 'signal_rules',
      route: ROUTE,
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

/**
 * Quantos pacientes ativos já deram o aceite. Duas contagens, não uma
 * proporção: a tela precisa dizer "8 de 140" e não "6%", porque é o número
 * absoluto que faz a clínica entender o que fazer a seguir.
 */
async function contagemDeAceite(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ comAceite: number; ativos: number }> {
  const ativos = await supabase
    .from('patients')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'ativo')
  const comAceite = await supabase
    .from('patients')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'ativo')
    .eq('outreach_opt_in', true)

  return { comAceite: comAceite.count ?? 0, ativos: ativos.count ?? 0 }
}
