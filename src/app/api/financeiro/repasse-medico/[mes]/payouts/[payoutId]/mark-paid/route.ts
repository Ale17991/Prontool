import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { markPayoutPaid } from '@/lib/core/monthly-payouts'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  paid_at: z.string().min(10),
  paid_amount_cents: z.number().int().positive(),
  payment_method: z.string().min(2).max(40),
  payment_note: z.string().max(500).optional().nullable(),
})

export async function POST(
  req: Request,
  context: { params: { mes: string; payoutId: string } },
): Promise<Response> {
  const route = `/api/financeiro/repasse-medico/${context.params.mes}/payouts/${context.params.payoutId}/mark-paid`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'monthly_payouts',
      entityId: context.params.payoutId,
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
    await markPayoutPaid(supabase, {
      tenantId: session.tenantId,
      payoutId: context.params.payoutId,
      paidAt: parsed.data.paid_at,
      paidAmountCents: parsed.data.paid_amount_cents,
      paymentMethod: parsed.data.payment_method,
      paymentNote: parsed.data.payment_note ?? null,
      actorUserId: session.userId,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
