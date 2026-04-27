import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { recordInstallmentPayment } from '@/lib/core/payments/record-installment'
import type { PaymentMethod } from '@/lib/core/payments/create'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const methodEnum = z.enum([
  'dinheiro',
  'pix',
  'cartao_credito',
  'cartao_debito',
  'boleto',
  'convenio',
  'outro',
])

const patchSchema = z.object({
  paid_amount_cents: z.number().int().min(0),
  payment_method: methodEnum,
  paid_at: z.string().optional().nullable(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; installmentId: string } },
): Promise<Response> {
  const route = `/api/pagamentos/${params.id}/parcelas/${params.installmentId}`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'payment_installments',
      entityId: params.installmentId,
      route,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload inválido',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await recordInstallmentPayment(supabase, {
      tenantId: session.tenantId,
      paymentRecordId: params.id,
      installmentId: params.installmentId,
      paidAmountCents: parsed.data.paid_amount_cents,
      paymentMethod: parsed.data.payment_method as PaymentMethod,
      paidAt: parsed.data.paid_at ?? undefined,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
