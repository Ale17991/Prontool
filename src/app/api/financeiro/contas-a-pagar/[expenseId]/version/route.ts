import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { versionRecurringExpense } from '@/lib/core/accounts-payable'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  new_amount_cents: z.number().int().positive(),
  reason: z.string().min(3).max(500),
})

export async function POST(
  req: Request,
  context: { params: { expenseId: string } },
): Promise<Response> {
  const route = `/api/financeiro/contas-a-pagar/${context.params.expenseId}/version`
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
    const result = await versionRecurringExpense(supabase, {
      tenantId: session.tenantId,
      expenseId: context.params.expenseId,
      effectiveFrom: parsed.data.effective_from,
      newAmountCents: parsed.data.new_amount_cents,
      reason: parsed.data.reason,
      actorUserId: session.userId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
