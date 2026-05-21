import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { markExpensePaid } from '@/lib/core/accounts-payable'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  paid_at: z.string().min(10),
  paid_amount_cents: z.number().int().positive(),
  payment_method: z.string().min(2).max(40),
})

export async function POST(
  req: Request,
  context: { params: { expenseId: string } },
): Promise<Response> {
  const route = `/api/financeiro/contas-a-pagar/${context.params.expenseId}/pay`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'expenses',
      entityId: context.params.expenseId,
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
    await markExpensePaid(supabase, {
      tenantId: session.tenantId,
      expenseId: context.params.expenseId,
      paidAt: parsed.data.paid_at,
      paidAmountCents: parsed.data.paid_amount_cents,
      paymentMethod: parsed.data.payment_method,
      actorUserId: session.userId,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
