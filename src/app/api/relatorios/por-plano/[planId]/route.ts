import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { detailByPlan } from '@/lib/core/reports/by-plan'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from deve ser YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to deve ser YYYY-MM-DD'),
})

const planIdSchema = z.string().uuid()

export async function GET(
  req: Request,
  { params }: { params: { planId: string } },
): Promise<Response> {
  const route = `/api/relatorios/por-plano/${params.planId}`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'reports',
      entityId: params.planId,
      route,
      request: req,
    })
    if (!planIdSchema.safeParse(params.planId).success) {
      return NextResponse.json(
        { error: { code: 'INVALID_PLAN_ID', message: 'planId deve ser UUID' } },
        { status: 400 },
      )
    }
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'from e to obrigatórios (YYYY-MM-DD)' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const detail = await detailByPlan(supabase, {
      tenantId: session.tenantId,
      planId: params.planId,
      from: parsed.data.from,
      to: parsed.data.to,
    })
    return NextResponse.json(detail, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
