import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { reopenMonthlyPayout } from '@/lib/core/monthly-payouts'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  reason: z.string().min(20).max(500),
})

export async function POST(
  req: Request,
  context: { params: { mes: string } },
): Promise<Response> {
  const route = `/api/financeiro/repasse-medico/${context.params.mes}/reopen`
  try {
    const session = await requireRole(['admin'], {
      entity: 'monthly_payouts_reopens',
      route,
      request: req,
    })
    const json = (await req.json()) as unknown
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: parsed.error.message } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await reopenMonthlyPayout(supabase, {
      tenantId: session.tenantId,
      month: context.params.mes,
      reason: parsed.data.reason,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
