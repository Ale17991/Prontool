import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { buildMonthlyReport, monthlyReportToWire } from '@/lib/core/reports/monthly'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T142 — GET /api/relatorios/mensal. Admin e financeiro (SC-009).
 * Recepcionista e profissional de saúde recebem 403.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from deve ser YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to deve ser YYYY-MM-DD'),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'reports',
      route: '/api/relatorios/mensal',
      request: req,
    })
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_QUERY', message: 'from e to obrigatórios (YYYY-MM-DD)' },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const report = await buildMonthlyReport(supabase, {
      tenantId: session.tenantId,
      from: parsed.data.from,
      to: parsed.data.to,
    })
    return NextResponse.json(monthlyReportToWire(report), { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/relatorios/mensal' })
  }
}
