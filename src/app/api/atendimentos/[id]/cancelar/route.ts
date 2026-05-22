import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { cancelAppointment } from '@/lib/core/appointments/cancel'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/atendimentos/[id]/cancelar
 *
 * Cancela um atendimento agendado/confirmado. Cria row em
 * appointment_cancellations. Slot lock e liberado para permitir
 * reagendar no mesmo horario.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  reason: z.enum([
    'no_show',
    'paciente_desmarcou',
    'clinica_desmarcou',
    'outro',
  ]),
  notes: z.string().trim().max(500).optional(),
})

interface RouteContext {
  params: { id: string }
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'recepcionista', 'profissional_saude'],
      {
        entity: 'appointments',
        entityId: ctx.params.id,
        route: '/api/atendimentos/[id]/cancelar',
        request: req,
      },
    )

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload invalido',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
    const { cancellationId } = await cancelAppointment(supabase, {
      appointmentId: ctx.params.id,
      actorUserId: session.userId,
      reason: parsed.data.reason,
      notes: parsed.data.notes,
    })

    return NextResponse.json(
      {
        cancellation_id: cancellationId,
        appointment_id: ctx.params.id,
        cancelled_at: new Date().toISOString(),
        reason: parsed.data.reason,
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: '/api/atendimentos/[id]/cancelar' })
  }
}
