import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { addAssistant } from '@/lib/core/appointment-assistants/add'
import { listAssistantsByAppointment } from '@/lib/core/appointment-assistants/list-by-appointment'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/atendimentos/{id}/assistants — lista assistentes ATIVOS do
 * atendimento + contagem de removidos. Útil para refresh sem recarregar
 * a página inteira.
 *
 * POST /api/atendimentos/{id}/assistants — adiciona um assistente liberal
 * a um atendimento existente. RPC trata validações + audit.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const postBodySchema = z.object({
  assistant_doctor_id: z.string().uuid(),
  amount_cents: z.number().int().positive().max(100_000_00),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/assistants`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'appointment_assistants', entityId: params.id, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const result = await listAssistantsByAppointment(supabase, {
      tenantId: session.tenantId,
      appointmentId: params.id,
    })
    return NextResponse.json(
      {
        active: result.active.map((a) => ({
          id: a.id,
          assistant_doctor_id: a.assistantDoctorId,
          doctor_name: a.doctorName,
          doctor_role: a.doctorRole,
          doctor_specialty: a.doctorSpecialty,
          frozen_amount_cents: a.frozenAmountCents,
          created_at: a.createdAt,
        })),
        removed_count: result.removedCount,
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/assistants`
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'appointment_assistants',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = postBodySchema.safeParse(await req.json().catch(() => null))
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
    const result = await addAssistant(supabase, {
      tenantId: session.tenantId,
      appointmentId: params.id,
      assistantDoctorId: parsed.data.assistant_doctor_id,
      amountCents: parsed.data.amount_cents,
      actorUserId: session.userId,
    })
    return NextResponse.json(
      { id: result.id, frozen_amount_cents: result.frozenAmountCents },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
