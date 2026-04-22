import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTreatmentPlan } from '@/lib/core/treatment-plans/get'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string; planId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/planos/${params.planId}`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'treatment_plans', entityId: params.planId, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const patientPlan = await supabase
      .from('patients')
      .select('plan_id')
      .eq('tenant_id', session.tenantId)
      .eq('id', params.id)
      .maybeSingle()
    const plan = await getTreatmentPlan(supabase, {
      tenantId: session.tenantId,
      planId: params.planId,
      patientPlanId: patientPlan.data?.plan_id ?? null,
    })
    if (plan.patientId !== params.id) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Plano não pertence ao paciente.' } },
        { status: 404 },
      )
    }
    return NextResponse.json(plan, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
