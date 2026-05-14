import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { importAppointmentToPlan } from '@/lib/core/treatment-steps/import-from-appointment'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/pacientes/{id}/atendimentos/{appointmentId}/importar-para-plano
 *
 * Cria uma `treatment_plan_steps` ja vinculada ao atendimento existente.
 * Usado pelo botao "Adicionar ao plano" no historico do paciente, quando
 * o auto-link FIFO em create-manual nao encontrou step compativel.
 *
 * RBAC: admin, financeiro e profissional_saude — mesmo que pode escrever
 * em treatment_plan_steps (alinhado a treatment-steps-section.tsx).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const paramsSchema = z.object({
  id: z.string().uuid(),
  appointmentId: z.string().uuid(),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string; appointmentId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/atendimentos/${params.appointmentId}/importar-para-plano`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'treatment_plan_steps',
      entityId: params.appointmentId,
      route,
      request: req,
    })

    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_PARAMS', message: 'id e appointmentId devem ser UUID' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const result = await importAppointmentToPlan(supabase, {
      tenantId: session.tenantId,
      patientId: parsed.data.id,
      appointmentId: parsed.data.appointmentId,
      actorUserId: session.userId,
    })

    return NextResponse.json(
      {
        step_id: result.stepId,
        appointment_id: result.appointmentId,
        status: result.status,
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
