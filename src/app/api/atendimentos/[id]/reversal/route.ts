import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { reverseAppointment } from '@/lib/core/appointments/reverse'
import { removeAppointmentFromGoogle } from '@/lib/core/integrations/google-calendar/sync'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T088b — POST /api/atendimentos/{id}/reversal.
 *
 * Thin wrapper: authenticate, gate to `admin` / `financeiro`, delegate to
 * `reverseAppointment` (T088a). Conflict on second reversal → 409.
 * Not-found (wrong tenant or missing id) → 404.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodyShape = z.object({ reason: z.string().min(3) })

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const appointmentId = params.id
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'appointment_reversals',
      entityId: appointmentId,
      route: `/api/atendimentos/${appointmentId}/reversal`,
      request: req,
    })

    const body = bodyShape.safeParse(await req.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'reason (min 3 chars) is required' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const result = await reverseAppointment(supabase, {
      appointmentId,
      tenantId: session.tenantId,
      actorUserId: session.userId,
      reason: body.data.reason,
    })

    // Remove o evento da agenda Google do profissional (best-effort).
    await removeAppointmentFromGoogle(supabase, appointmentId, session.tenantId)

    return NextResponse.json(
      {
        id: result.reversalId,
        appointment_id: appointmentId,
        reversal_amount_cents: result.reversalAmountCents,
        reason: body.data.reason,
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/atendimentos/${appointmentId}/reversal` })
  }
}
