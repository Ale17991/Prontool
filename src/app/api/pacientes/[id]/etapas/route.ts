import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTreatmentSteps } from '@/lib/core/treatment-steps/list'
import { createTreatmentStep } from '@/lib/core/treatment-steps/create'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  procedure_id: z.string().uuid(),
  health_plan_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional().nullable(),
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD')
    .optional()
    .nullable(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/etapas`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'treatment_plan_steps', route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    // Busca o plano do paciente pra usar como fallback na resolução de preço.
    const pat = await supabase
      .from('patients')
      .select('plan_id')
      .eq('tenant_id', session.tenantId)
      .eq('id', params.id)
      .maybeSingle()

    const steps = await listTreatmentSteps(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      patientPlanId: pat.data?.plan_id ?? null,
    })
    return NextResponse.json(steps, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/etapas`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'treatment_plan_steps',
      route,
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload inválido',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const step = await createTreatmentStep(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      patientId: params.id,
      procedureId: parsed.data.procedure_id,
      healthPlanId: parsed.data.health_plan_id ?? null,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      scheduledDate: parsed.data.scheduled_date ?? null,
    })
    return NextResponse.json(step, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
