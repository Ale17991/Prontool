import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { addPlanItem } from '@/lib/core/dental/treatment-plan/add-plan-item'
import { SURFACES } from '@/lib/core/dental/teeth'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  tooth_fdi: z.number().int(),
  surface: z.enum(SURFACES).optional().nullable(),
  procedure_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  health_plan_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional().nullable(),
  scheduled_date: z.string().optional().nullable(),
})

/** Cria um item de plano odontológico (etapa com posição dentária). */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/plano/itens`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'treatment_plan_steps',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await addPlanItem(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      toothFdi: parsed.data.tooth_fdi,
      surface: parsed.data.surface ?? null,
      procedureId: parsed.data.procedure_id,
      doctorId: parsed.data.doctor_id,
      healthPlanId: parsed.data.health_plan_id ?? null,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      scheduledDate: parsed.data.scheduled_date ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
