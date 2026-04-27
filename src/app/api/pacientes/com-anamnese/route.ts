import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createPatientWithAnamnesis } from '@/lib/core/patients/create-with-anamnesis'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/pacientes/com-anamnese — cria paciente + anamnese em fluxo
 * único. Responses contém os campos do template (default_* + custom) e
 * patient_plan_id é o Select explícito da UI (sobrescreve qualquer
 * texto digitado em default_plano).
 *
 * Permissão: admin / recepcionista.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  template_id: z.string().uuid(),
  responses: z.record(z.unknown()),
  patient_plan_id: z.string().uuid().optional().nullable(),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'patients',
      route: '/api/pacientes/com-anamnese',
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
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
    const result = await createPatientWithAnamnesis(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      templateId: parsed.data.template_id,
      responses: parsed.data.responses,
      patientPlanId: parsed.data.patient_plan_id ?? null,
    })
    return NextResponse.json(
      {
        patient_id: result.patientId,
        record_id: result.recordId,
        ghl_synced: result.patientCreate.ghlSynced,
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: '/api/pacientes/com-anamnese' })
  }
}
