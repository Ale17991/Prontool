import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { buildDoctorPlanMatrix } from '@/lib/core/reports/doctor-plan-matrix'
import { renderDoctorPlanMatrixExcel } from '@/lib/core/reports/export-doctor-plan-matrix-excel'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from deve ser YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to deve ser YYYY-MM-DD'),
})

const formatSchema = z.enum(['excel'])

export async function GET(
  req: Request,
  { params }: { params: { formato: string } },
): Promise<Response> {
  const route = `/api/relatorios/medico-plano/export/${params.formato}`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'reports',
      route,
      request: req,
    })
    const formatParsed = formatSchema.safeParse(params.formato)
    if (!formatParsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_FORMAT', message: 'formato deve ser excel' } },
        { status: 400 },
      )
    }
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'from e to obrigatórios (YYYY-MM-DD)' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const matrix = await buildDoctorPlanMatrix(supabase, {
      tenantId: session.tenantId,
      from: parsed.data.from,
      to: parsed.data.to,
    })

    const xlsx = await renderDoctorPlanMatrixExcel(matrix, {
      tenantLabel: session.tenantId,
      from: parsed.data.from,
      to: parsed.data.to,
    })
    const filenameStem = `relatorio-medico-plano-${parsed.data.from}-${parsed.data.to}`
    return new Response(new Uint8Array(xlsx), {
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${filenameStem}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
