import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { detailByProfessional } from '@/lib/core/reports/by-professional'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from deve ser YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to deve ser YYYY-MM-DD'),
})

const doctorIdSchema = z.string().uuid()

export async function GET(
  req: Request,
  { params }: { params: { doctorId: string } },
): Promise<Response> {
  const route = `/api/relatorios/por-profissional/${params.doctorId}`
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
    return NextResponse.json(detail, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
