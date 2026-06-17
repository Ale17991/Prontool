import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { registerGlosa } from '@/lib/core/tiss/glosa'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/tiss/glosas → registra uma glosa (motivo Tabela 38 + valor) numa
 * guia enviada e atualiza o status para `glosada`/`parcial` (admin/financeiro).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/tiss/glosas'

const bodySchema = z.object({
  guiaId: z.string().uuid(),
  guiaProcedureId: z.string().uuid().nullable().optional(),
  motivoCode: z.string().trim().regex(/^\d{1,4}$/, 'Motivo deve ser numérico (Tabela 38).'),
  motivoText: z.string().trim().min(1).max(500),
  glosadoAmountCents: z.number().int().min(0),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'tiss_glosas',
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
    const result = await registerGlosa({
      supabase,
      tenantId: session.tenantId,
      guiaId: parsed.data.guiaId,
      guiaProcedureId: parsed.data.guiaProcedureId ?? null,
      motivoCode: parsed.data.motivoCode,
      motivoText: parsed.data.motivoText,
      glosadoAmountCents: parsed.data.glosadoAmountCents,
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
