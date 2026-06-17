import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { reapresentarGuia } from '@/lib/core/tiss/glosa'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/tiss/glosas/reapresentar → cria nova guia (reapresentação) a partir
 * de uma guia glosada, mantendo o vínculo `supersedes_guia_id` (admin/financeiro).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/tiss/glosas/reapresentar'

const bodySchema = z.object({ guiaId: z.string().uuid() })

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'tiss_guias',
      route: ROUTE,
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'guiaId (UUID) obrigatório.' } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await reapresentarGuia({
      supabase,
      tenantId: session.tenantId,
      guiaId: parsed.data.guiaId,
      actorUserId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
