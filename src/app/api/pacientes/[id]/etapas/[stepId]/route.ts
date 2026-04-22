import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { updateTreatmentStepStatus } from '@/lib/core/treatment-steps/update-status'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  status: z.enum(['concluido', 'cancelado']),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; stepId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/etapas/${params.stepId}`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'treatment_plan_steps',
      entityId: params.stepId,
      route,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
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
    await updateTreatmentStepStatus(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      stepId: params.stepId,
      status: parsed.data.status,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
