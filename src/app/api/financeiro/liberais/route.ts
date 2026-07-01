import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  aggregateLiberalByPeriod,
  listLiberalSettlements,
  recordLiberalSettlement,
} from '@/lib/core/liberal-settlements'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/financeiro/liberais?from=&to= — totais por profissional + histórico. */
export async function GET(req: Request): Promise<Response> {
  const route = '/api/financeiro/liberais'
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'liberal_payment_settlements',
      route,
      request: req,
    })
    const sp = new URL(req.url).searchParams
    const from = sp.get('from')
    const to = sp.get('to')
    const supabase = createSupabaseServiceClient()
    const [rows, settlements] = await Promise.all([
      from && to
        ? aggregateLiberalByPeriod(supabase, { tenantId: session.tenantId, from, to })
        : Promise.resolve([]),
      listLiberalSettlements(supabase, { tenantId: session.tenantId }),
    ])
    return NextResponse.json({ rows, settlements }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

const postSchema = z.object({
  doctor_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.number().int().min(0).max(100_000_000),
  note: z.string().trim().max(500).nullable().optional(),
})

/** POST /api/financeiro/liberais — registra pagamento de um período. */
export async function POST(req: Request): Promise<Response> {
  const route = '/api/financeiro/liberais'
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'liberal_payment_settlements',
      route,
      request: req,
    })
    const parsed = postSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await recordLiberalSettlement(supabase, {
      tenantId: session.tenantId,
      doctorId: parsed.data.doctor_id,
      from: parsed.data.from,
      to: parsed.data.to,
      amountCents: parsed.data.amount_cents,
      note: parsed.data.note ?? null,
      actorUserId: session.userId,
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
