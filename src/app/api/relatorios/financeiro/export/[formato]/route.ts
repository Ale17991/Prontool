import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { buildFinancialReport } from '@/lib/core/reports/financial-report'
import { renderFinancialReportPdf } from '@/lib/core/reports/export-financial-pdf'
import { renderFinancialReportExcel } from '@/lib/core/reports/export-financial-excel'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from deve ser YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to deve ser YYYY-MM-DD'),
})

const formatSchema = z.enum(['pdf', 'excel'])

export async function GET(
  req: Request,
  { params }: { params: { formato: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'reports',
      route: `/api/relatorios/financeiro/export/${params.formato}`,
      request: req,
    })
    const formatParsed = formatSchema.safeParse(params.formato)
    if (!formatParsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_FORMAT', message: 'formato deve ser pdf ou excel' } },
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
    const report = await buildFinancialReport(supabase, {
      tenantId: session.tenantId,
      from: parsed.data.from,
      to: parsed.data.to,
    })

    const filenameStem = `relatorio-financeiro-${parsed.data.from}-${parsed.data.to}`

    if (formatParsed.data === 'pdf') {
      const buf = await renderFinancialReportPdf(report, { tenantLabel: session.tenantId })
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filenameStem}.pdf"`,
          'cache-control': 'no-store',
        },
      })
    }

    const xlsx = await renderFinancialReportExcel(report, { tenantLabel: session.tenantId })
    return new Response(new Uint8Array(xlsx), {
      status: 200,
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${filenameStem}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, {
      route: `/api/relatorios/financeiro/export/${params.formato}`,
    })
  }
}
