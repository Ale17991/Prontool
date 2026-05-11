import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTreatmentSteps } from '@/lib/core/treatment-steps/list'
import { createTreatmentStep } from '@/lib/core/treatment-steps/create'
import { createStepWithAppointment } from '@/lib/core/treatment-steps/create-with-appointment'
import { attachMaterialsToAppointment } from '@/lib/core/appointments/materials/attach'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const materialItemSchema = z.object({
  tuss_code: z.string().min(1).max(20),
  tuss_description: z.string().min(1).max(500),
  quantity: z.number().int().positive().default(1),
})

const createSchema = z.object({
  procedure_id: z.string().uuid(),
  doctor_id: z.string().uuid({ message: 'Selecione um profissional responsável' }),
  health_plan_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional().nullable(),
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD')
    .optional()
    .nullable(),
  // Novos campos da feature 005: horario obrigatorio quando ambos vierem.
  // Compat: se ambos ausentes, legado (sem appointment vinculado).
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  /** Materiais opcionais (TUSS tabela 19). Anexados apenas quando ha appointment vinculado. */
  materiais: z.array(materialItemSchema).max(50).optional(),
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

    // Caminho NOVO: scheduled_date + start_time + end_time presentes →
    // RPC create_step_with_appointment cria appointment + step linkados.
    const hasSchedule =
      parsed.data.scheduled_date && parsed.data.start_time && parsed.data.end_time
    if (hasSchedule) {
      const result = await createStepWithAppointment(supabase, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        patientId: params.id,
        procedureId: parsed.data.procedure_id,
        doctorId: parsed.data.doctor_id,
        healthPlanId: parsed.data.health_plan_id ?? null,
        title: parsed.data.title,
        notes: parsed.data.notes ?? null,
        scheduledDate: parsed.data.scheduled_date as string,
        startTime: parsed.data.start_time as string,
        endTime: parsed.data.end_time as string,
      })

      // Anexa materiais ao appointment recem-criado, se houver.
      if (parsed.data.materiais && parsed.data.materiais.length > 0) {
        const attached = await attachMaterialsToAppointment(supabase, {
          appointmentId: result.appointment_id,
          tenantId: session.tenantId,
          actorUserId: session.userId,
          materials: parsed.data.materiais.map((m) => ({
            tussCode: m.tuss_code,
            tussDescription: m.tuss_description,
            quantity: m.quantity,
          })),
        })
        return NextResponse.json(
          { ...result, materials_count: attached.materials.length },
          { status: 201 },
        )
      }

      return NextResponse.json(result, { status: 201 })
    }

    // Caminho LEGADO: sem horario → cria etapa solta (sem appointment).
    const step = await createTreatmentStep(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      patientId: params.id,
      procedureId: parsed.data.procedure_id,
      doctorId: parsed.data.doctor_id,
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
