import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { confirmAppointment } from '@/lib/core/appointments/confirm'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/atendimentos/[id]/confirmar
 *
 * Marca um atendimento como CONFIRMADO (paciente avisou que vira).
 * Cria row em appointment_confirmations.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  notes: z.string().trim().max(500).optional(),
})

interface RouteContext {
  params: { id: string }
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'recepcionista', 'profissional_saude'], {
      entity: 'appointments',
      entityId: ctx.params.id,
      route: '/api/atendimentos/[id]/confirmar',
      request: req,
    })

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
    const { confirmationId } = await confirmAppointment(supabase, {
      appointmentId: ctx.params.id,
      actorUserId: session.userId,
      notes: parsed.data.notes,
    })

    return NextResponse.json(
      {
        confirmation_id: confirmationId,
        appointment_id: ctx.params.id,
        confirmed_at: new Date().toISOString(),
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: '/api/atendimentos/[id]/confirmar' })
  }
}
