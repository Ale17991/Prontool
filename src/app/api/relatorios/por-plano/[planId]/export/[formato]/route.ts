import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { detailByPlan, PARTICULAR_KEY } from '@/lib/core/reports/by-plan'
import { renderByPlanPdf } from '@/lib/core/reports/export-by-plan-pdf'
import { renderByPlanExcel } from '@/lib/core/reports/export-by-plan-excel'
import { toHttpResponse } from '@/lib/observability/http'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from deve ser YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to deve ser YYYY-MM-DD'),
})

const formatSchema = z.enum(['pdf', 'excel'])
// planId aceita UUID OU o sentinel 'particular' (linhas com plan_id IS NULL).
const planIdSchema = z.union([z.literal(PARTICULAR_KEY), z.string().uuid()])

export async function GET(
  req: Request,
  { params }: { params: { planId: string; formato: string } },
): Promise<Response> {
  const route = `/api/relatorios/por-plano/${params.planId}/export/${params.formato}`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'reports',
      entityId: params.planId,
      route,
      request: req,
    })
    if (!planIdSchema.safeParse(params.planId).success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_PLAN_ID',
            message: 'planId deve ser UUID ou "particular"',
          },
        },
        { status: 400 },
      )
    }
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
    const detail = await detailByPlan(supabase, {
      tenantId: session.tenantId,
      planId: params.planId === PARTICULAR_KEY ? null : params.planId,
      from: parsed.data.from,
      to: parsed.data.to,
    })

    const slug = detail.plan.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40)
    const filenameStem = `relatorio-${slug}-${parsed.data.from}-${parsed.data.to}`

    if (formatParsed.data === 'pdf') {
      const clinicProfile = await getClinicProfile(
        supabase,
        session.tenantId,
        CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
      ).catch(() => null)
      const buf = await renderByPlanPdf(detail, {
        tenantLabel: session.tenantId,
        clinicProfile,
        signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
      })
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filenameStem}.pdf"`,
          'cache-control': 'no-store',
        },
      })
    }

    const xlsx = await renderByPlanExcel(detail, { tenantLabel: session.tenantId })
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
