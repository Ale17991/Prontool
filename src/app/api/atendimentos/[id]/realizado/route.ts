import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { markAppointmentRealized } from '@/lib/core/appointments/mark-realized'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/atendimentos/[id]/realizado
 *
 * Marca um atendimento agendado como realizado. Insere row em
 * appointment_completions; trigger lateral marca a etapa vinculada
 * (se houver) como concluida.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

interface RouteContext {
  params: { id: string }
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'appointments',
      entityId: ctx.params.id,
      route: '/api/atendimentos/[id]/realizado',
      request: req,
    })

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
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

    const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
    const { completionId } = await markAppointmentRealized(supabase, {
      appointmentId: ctx.params.id,
      actorUserId: session.userId,
      reason: parsed.data.reason,
    })

    return NextResponse.json(
      {
        completion_id: completionId,
        appointment_id: ctx.params.id,
        completed_at: new Date().toISOString(),
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: '/api/atendimentos/[id]/realizado' })
  }
}
