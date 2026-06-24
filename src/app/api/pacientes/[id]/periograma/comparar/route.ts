import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { comparePerioExams } from '@/lib/core/dental/perio/compare-exams'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid(),
})

/** Compara dois exames finalizados do paciente. */
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/periograma/comparar`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'perio_exams', entityId: params.id, route, request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'NEED_TWO_EXAMS', message: 'Informe dois exames (from e to).' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const data = await comparePerioExams(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      fromExamId: parsed.data.from,
      toExamId: parsed.data.to,
    })
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
