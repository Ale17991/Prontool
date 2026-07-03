import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  addCashBalanceAdjustment,
  listCashBalanceAdjustments,
  tenantCashBalanceAt,
} from '@/lib/core/cash-balance'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z
    .number()
    .int()
    .refine((v) => v !== 0, 'amount_cents must be != 0'),
  reason: z.string().min(3).max(500),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/configuracoes/cash-balance'
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'tenant_cash_balance_adjustments',
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const [history, today] = await Promise.all([
      listCashBalanceAdjustments(supabase, { tenantId: session.tenantId, limit: 10 }),
      tenantCashBalanceAt(supabase, {
        tenantId: session.tenantId,
        date: new Date().toISOString().slice(0, 10),
      }),
    ])
    return NextResponse.json(
      {
        current_balance_cents: today,
        as_of: new Date().toISOString().slice(0, 10),
        history,
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/configuracoes/cash-balance'
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_cash_balance_adjustments',
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
    const created = await addCashBalanceAdjustment(supabase, {
      tenantId: session.tenantId,
      effectiveFrom: parsed.data.effective_from,
      amountCents: parsed.data.amount_cents,
      reason: parsed.data.reason,
      actorUserId: session.userId,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
