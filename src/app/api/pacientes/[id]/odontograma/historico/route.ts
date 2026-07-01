import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listChartHistory } from '@/lib/core/dental/chart/list-history'
import { SURFACES } from '@/lib/core/dental/teeth'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  toothFdi: z.coerce.number().int(),
  surface: z.enum(SURFACES).optional(),
})

/** Histórico append-only por posição (US3/FR-016). */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/odontograma/historico`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'dental_chart_entries',
      entityId: params.id,
      route,
      request: req,
    })
    const url = new URL(req.url)
    const parsed = querySchema.safeParse({
      toothFdi: url.searchParams.get('toothFdi'),
      surface: url.searchParams.get('surface') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_QUERY',
            message: 'Parâmetros inválidos',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const items = await listChartHistory(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      toothFdi: parsed.data.toothFdi,
      surface: parsed.data.surface ?? null,
    })
    return NextResponse.json({ items }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
