import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listExpenses } from '@/lib/core/expenses/list'
import { renderExpensesExcel } from '@/lib/core/expenses/export-excel'
import { renderExpensesPdf } from '@/lib/core/expenses/export-pdf'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const formatSchema = z.enum(['pdf', 'excel'])
const VALID_CATEGORIES = new Set([
  'aluguel', 'equipamentos', 'materiais', 'pessoal', 'servicos', 'impostos', 'manutencao', 'outros',
])
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(
  req: Request,
  { params }: { params: { formato: string } },
): Promise<Response> {
  const route = `/api/despesas/export/${params.formato}`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'expenses',
      route,
      request: req,
    })
    const fmt = formatSchema.safeParse(params.formato)
    if (!fmt.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_FORMAT', message: 'formato deve ser pdf ou excel' } },
        { status: 400 },
      )
    }

    const sp = new URL(req.url).searchParams
    const categoryRaw = sp.get('category')
    const category =
      categoryRaw && VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : 'all'
    const from = sp.get('from')
    const to = sp.get('to')
    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'from/to devem ser YYYY-MM-DD' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const rows = await listExpenses(supabase, {
      tenantId: session.tenantId,
      category: category as never,
      startDate: from ?? undefined,
      endDate: to ?? undefined,
    })

    const meta = { tenantLabel: session.tenantId, from, to, category }
    const stem = `despesas${from ? `-${from}` : ''}${to ? `-${to}` : ''}`

    if (fmt.data === 'pdf') {
      const clinicProfile = await getClinicProfile(
        supabase,
        session.tenantId,
        CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
      ).catch(() => null)
      const buf = await renderExpensesPdf(rows as never, {
        ...meta,
        clinicProfile,
        signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
      })
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${stem}.pdf"`,
          'cache-control': 'no-store',
        },
      })
    }

    const xlsx = await renderExpensesExcel(rows as never, meta)
    return new Response(new Uint8Array(xlsx), {
      status: 200,
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${stem}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
