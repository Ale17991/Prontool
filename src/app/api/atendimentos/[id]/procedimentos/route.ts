import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { addProcedureToAppointment } from '@/lib/core/appointments/procedures/add'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const postSchema = z.object({
  procedure_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99).optional(),
  amount_cents_override: z.number().int().min(0).max(100_000_00).nullable().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/procedimentos`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'appointment_procedures', entityId: params.id, route, request: req },
    )
    const parsed = postSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await addProcedureToAppointment(supabase, {
      tenantId: session.tenantId,
      appointmentId: params.id,
      procedureId: parsed.data.procedure_id,
      actorUserId: session.userId,
      quantity: parsed.data.quantity,
      amountCentsOverride: parsed.data.amount_cents_override ?? null,
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
