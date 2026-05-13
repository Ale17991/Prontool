import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { detailByProfessional } from '@/lib/core/reports/by-professional'
import { renderByProfessionalPdf } from '@/lib/core/reports/export-by-professional-pdf'
import { renderByProfessionalExcel } from '@/lib/core/reports/export-by-professional-excel'
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
const doctorIdSchema = z.string().uuid()

export async function GET(
  req: Request,
  { params }: { params: { doctorId: string; formato: string } },
): Promise<Response> {
  const route = `/api/relatorios/por-profissional/${params.doctorId}/export/${params.formato}`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'reports',
      entityId: params.doctorId,
      route,
      request: req,
    })
    if (!doctorIdSchema.safeParse(params.doctorId).success) {
      return NextResponse.json(
        { error: { code: 'INVALID_DOCTOR_ID', message: 'doctorId deve ser UUID' } },
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
    const detail = await detailByProfessional(supabase, {
      tenantId: session.tenantId,
      doctorId: params.doctorId,
      from: parsed.data.from,
      to: parsed.data.to,
    })

    const slug = detail.doctor.fullName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40)
    const filenameStem = `relatorio-profissional-${slug}-${parsed.data.from}-${parsed.data.to}`

    if (formatParsed.data === 'pdf') {
      const clinicProfile = await getClinicProfile(
        supabase,
        session.tenantId,
        CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
      ).catch(() => null)
      const buf = await renderByProfessionalPdf(detail, {
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

    const xlsx = await renderByProfessionalExcel(detail, { tenantLabel: session.tenantId })
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
    return toHttpResponse(err, { route })
  }
}
