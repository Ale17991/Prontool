import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { closeMonthlyPayout } from '@/lib/core/monthly-payouts'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, context: { params: { mes: string } }): Promise<Response> {
  const route = `/api/financeiro/repasse-medico/${context.params.mes}/close`
  try {
    const session = await requireRole(['admin'], {
      entity: 'monthly_payouts',
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await closeMonthlyPayout(supabase, {
      tenantId: session.tenantId,
      month: context.params.mes,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
