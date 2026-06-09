import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  tissOperatorConfigSchema,
  upsertTissOperatorConfig,
  deactivateTissOperatorConfig,
} from '@/lib/core/tiss/operator-config'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST   /api/tiss/operadoras/[planId] → habilita/atualiza config TISS da operadora (admin).
 * DELETE /api/tiss/operadoras/[planId] → desabilita (mantém histórico de guias).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/tiss/operadoras/[planId]'

function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}
function actorLabel(email: string | null, userId: string): string {
  return email ? `user:${email}` : `user:${userId}`
}

export async function POST(
  req: Request,
  { params }: { params: { planId: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_tiss_operator_config',
      route: ROUTE,
      request: req,
    })
    const parsed = tissOperatorConfigSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Dados da operadora incompletos ou inválidos.',
            fields: parsed.error.issues.map((i) => ({
              field: i.path.join('.'),
              message: i.message,
            })),
          },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await upsertTissOperatorConfig({
      supabase,
      tenantId: session.tenantId,
      healthPlanId: params.planId,
      config: parsed.data,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json({ id: result.id, status: 'habilitado' }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { planId: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_tiss_operator_config',
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await deactivateTissOperatorConfig({
      supabase,
      tenantId: session.tenantId,
      healthPlanId: params.planId,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
