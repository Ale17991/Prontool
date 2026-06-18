import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { recordLotePayment } from '@/lib/core/tiss/receivables'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/tiss/lotes/[id]/pagamentos → registra um recebimento do convênio
 * para o lote (conciliação, parcial permitido). admin/financeiro.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  amountCents: z.number().int().positive(),
  note: z.string().trim().max(500).nullable().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/tiss/lotes/${params.id}/pagamentos`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'tiss_lotes',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Dados inválidos.',
            fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await recordLotePayment({
      supabase,
      tenantId: session.tenantId,
      loteId: params.id,
      amountCents: parsed.data.amountCents,
      note: parsed.data.note ?? null,
      actorUserId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
