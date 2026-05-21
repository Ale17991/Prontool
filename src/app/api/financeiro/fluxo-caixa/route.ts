import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { assembleCashFlow } from '@/lib/core/cash-flow'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scale: z.enum(['daily', 'weekly', 'monthly']).optional(),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/financeiro/fluxo-caixa'
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'cash_flow',
      route,
      request: req,
    })
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await assembleCashFlow(supabase, {
      tenantId: session.tenantId,
      from: parsed.data.from,
      to: parsed.data.to,
      scale: parsed.data.scale ?? 'daily',
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
