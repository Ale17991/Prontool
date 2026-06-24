import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { finalizePerioExam } from '@/lib/core/dental/perio/finalize-exam'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Finaliza (congela) o exame periodontal. */
export async function POST(
  req: Request,
  { params }: { params: { id: string; examId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/periograma/${params.examId}/finalizar`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'perio_exams',
      entityId: params.examId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await finalizePerioExam(supabase, {
      tenantId: session.tenantId,
      examId: params.examId,
      actorUserId: session.userId,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
