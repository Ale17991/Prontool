import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createLote } from '@/lib/core/tiss/build-lote'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/tiss/lotes → fecha e assina um lote de guias `pronta` de UMA
 * operadora (admin/financeiro). Retorna { loteId, loteNumber, xmlHashMd5, guiaCount }.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/tiss/lotes'

const bodySchema = z.object({
  healthPlanId: z.string().uuid({ message: 'healthPlanId deve ser um UUID.' }),
  guiaIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma guia.'),
})

function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}
function actorLabel(email: string | null, userId: string): string {
  return email ? `user:${email}` : `user:${userId}`
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'tiss_lotes',
      route: ROUTE,
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
    const result = await createLote({
      supabase,
      tenantId: session.tenantId,
      healthPlanId: parsed.data.healthPlanId,
      guiaIds: parsed.data.guiaIds,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
