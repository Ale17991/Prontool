import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPlan } from '@/lib/core/dental/treatment-plan/list-plan'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Visão do plano de tratamento do paciente (itens + orçamentos + progresso). */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/plano`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'treatment_plan_steps',
        entityId: params.id,
        route,
        request: req,
      },
    )
    const supabase = createSupabaseServiceClient()
    const plan = await listPlan(supabase, { tenantId: session.tenantId, patientId: params.id })
    return NextResponse.json(plan, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
