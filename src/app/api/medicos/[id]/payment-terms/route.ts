import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPaymentTermsHistory } from '@/lib/core/payment-terms/list-history'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/medicos/{id}/payment-terms — head-of-chain + histórico
 * de modalidades de pagamento do profissional (feature 013).
 *
 * RBAC: admin e financeiro (mesma autorização que /relatorios).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/medicos/${params.id}/payment-terms`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'doctors',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await listPaymentTermsHistory(supabase, {
      tenantId: session.tenantId,
      doctorId: params.id,
    })
    return NextResponse.json(
      {
        doctor_id: params.id,
        current: result.current
          ? {
              payment_mode: result.current.paymentMode,
              percentage_bps: result.current.percentageBps,
              monthly_amount_cents: result.current.monthlyAmountCents,
              billing_day: result.current.billingDay,
              liberal_default_cents: result.current.liberalDefaultCents,
              valid_from: result.current.validFrom,
            }
          : null,
        history: result.history.map((r) => ({
          id: r.id,
          payment_mode: r.paymentMode,
          percentage_bps: r.percentageBps,
          monthly_amount_cents: r.monthlyAmountCents,
          billing_day: r.billingDay,
          liberal_default_cents: r.liberalDefaultCents,
          valid_from: r.validFrom,
          reason: r.reason,
          created_by: r.createdBy,
          created_at: r.createdAt,
        })),
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
