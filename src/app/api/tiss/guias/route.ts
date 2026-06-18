import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { generateConsultaGuia, generateSpSadtGuia } from '@/lib/core/tiss/build-guia'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/tiss/guias → gera a Guia de Consulta de um atendimento (admin/financeiro).
 * Retorna { guiaId, guiaNumber, status, validationErrors }. Status `pronta` ou
 * `rascunho` (com pendências) — espelha o bloqueio de prescrição da Memed.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/tiss/guias'

const bodySchema = z.object({
  appointmentId: z.string().uuid({ message: 'appointmentId deve ser um UUID.' }),
  guiaType: z.enum(['consulta', 'sp_sadt']).default('consulta'),
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
      entity: 'tiss_guias',
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
    const genArgs = {
      supabase,
      tenantId: session.tenantId,
      appointmentId: parsed.data.appointmentId,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    }
    const result =
      parsed.data.guiaType === 'sp_sadt'
        ? await generateSpSadtGuia(genArgs)
        : await generateConsultaGuia(genArgs)
    // O modelo de render fica server-side (usado ao lotear) — não expõe ao browser.
    return NextResponse.json(
      {
        guiaId: result.guiaId,
        guiaNumber: result.guiaNumber,
        status: result.status,
        validationErrors: result.validationErrors,
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
