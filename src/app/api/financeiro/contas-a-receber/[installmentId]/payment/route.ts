import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { recordInstallmentPayment } from '@/lib/core/installment-payments'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  amount_cents: z.number().int().positive(),
  payment_method: z.string().min(2).max(40),
  paid_at: z.string().min(10),
  note: z.string().max(500).optional().nullable(),
})

export async function POST(
  req: Request,
  context: { params: { installmentId: string } },
): Promise<Response> {
  const route = `/api/financeiro/contas-a-receber/${context.params.installmentId}/payment`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista'],
      {
        entity: 'installment_payments',
        entityId: context.params.installmentId,
        route,
        request: req,
      },
    )
    const json = (await req.json()) as unknown
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: parsed.error.message } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const payment = await recordInstallmentPayment(supabase, {
      tenantId: session.tenantId,
      installmentId: context.params.installmentId,
      amountCents: parsed.data.amount_cents,
      paymentMethod: parsed.data.payment_method,
      paidAt: parsed.data.paid_at,
      note: parsed.data.note,
      actorUserId: session.userId,
    })
    return NextResponse.json(payment, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
