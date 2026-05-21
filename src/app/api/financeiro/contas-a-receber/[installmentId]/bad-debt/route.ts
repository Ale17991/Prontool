import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { markInstallmentAsBadDebt } from '@/lib/core/accounts-receivable'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  reason: z.string().min(10).max(500).optional().nullable(),
})

export async function POST(
  req: Request,
  context: { params: { installmentId: string } },
): Promise<Response> {
  const route = `/api/financeiro/contas-a-receber/${context.params.installmentId}/bad-debt`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'payment_installments',
      entityId: context.params.installmentId,
      route,
      request: req,
    })
    const json = (await req.json().catch(() => ({}))) as unknown
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: parsed.error.message } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await markInstallmentAsBadDebt(supabase, {
      tenantId: session.tenantId,
      installmentId: context.params.installmentId,
      actorUserId: session.userId,
      reason: parsed.data.reason ?? undefined,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
