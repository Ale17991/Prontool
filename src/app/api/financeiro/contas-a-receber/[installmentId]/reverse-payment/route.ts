import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { reverseInstallmentPayment } from '@/lib/core/installment-payments'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  reason: z.string().min(10).max(500),
})

export async function POST(
  req: Request,
  context: { params: { installmentId: string } },
): Promise<Response> {
  const route = `/api/financeiro/contas-a-receber/${context.params.installmentId}/reverse-payment`
  try {
    const session = await requireRole(['admin'], {
      entity: 'installment_payments',
      entityId: context.params.installmentId,
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
    const reversal = await reverseInstallmentPayment(supabase, {
      tenantId: session.tenantId,
      installmentId: context.params.installmentId,
      paymentId: parsed.data.payment_id,
      reason: parsed.data.reason,
      actorUserId: session.userId,
    })
    return NextResponse.json(reversal, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
