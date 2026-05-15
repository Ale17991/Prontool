import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { computeOperatingResult } from '@/lib/core/reports/operating-result'
import { ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/relatorios/resultado-operacional?month=YYYY-MM — feature 013 US3.
 *
 * Retorna a fórmula:
 *   gross_revenue − commissions − fixed_payments − liberal_payments
 *                 − taxes − operating_expenses = net_profit
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month deve ser 'YYYY-MM'"),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/relatorios/resultado-operacional'
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'reports',
      route,
      request: req,
    })
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'month inválido' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    try {
      const result = await computeOperatingResult(supabase, {
        tenantId: session.tenantId,
        month: parsed.data.month,
      })
      return NextResponse.json(result, { status: 200 })
    } catch (err) {
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: 400 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
