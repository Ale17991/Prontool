import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { addTreatmentPlanStep } from '@/lib/core/treatment-plans/add-step'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const addSchema = z.object({
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

export async function POST(
  req: Request,
  { params }: { params: { id: string; planId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/planos/${params.planId}/steps`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'treatment_plan_steps',
      route,
      request: req,
    })
    const parsed = addSchema.safeParse(await req.json().catch(() => null))
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
    const step = await addTreatmentPlanStep(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      planId: params.planId,
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
