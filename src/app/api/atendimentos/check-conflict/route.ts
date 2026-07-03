import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { checkConflict } from '@/lib/core/appointments/check-conflict'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/atendimentos/check-conflict
 *
 * Pre-check de conflito de horario por profissional. Usado pelos formularios
 * de "Novo atendimento" e "Nova etapa do plano de tratamento" para feedback
 * imediato ao usuario antes do submit.
 *
 * O veto autoritativo continua sendo a EXCLUDE constraint no banco
 * (appointment_slot_locks). Esta rota e UX preventiva.
 */
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  doctor_id: z.string().uuid(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  exclude_id: z.string().uuid().optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'appointments',
        route: '/api/atendimentos/check-conflict',
        request: req,
      },
    )

    const url = new URL(req.url)
    const parsed = querySchema.safeParse({
      doctor_id: url.searchParams.get('doctor_id'),
      start: url.searchParams.get('start'),
      end: url.searchParams.get('end'),
      exclude_id: url.searchParams.get('exclude_id') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_QUERY',
            message: 'parametros invalidos',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }

    const startAt = new Date(parsed.data.start)
    const endAt = new Date(parsed.data.end)
    if (endAt.getTime() <= startAt.getTime()) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'end deve ser depois de start' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
    const encryptionKey = process.env.PATIENT_DATA_ENCRYPTION_KEY
    const service = encryptionKey ? createSupabaseServiceClient() : undefined

    const hit = await checkConflict(
      supabase,
      {
        tenantId: session.tenantId,
        doctorId: parsed.data.doctor_id,
        startAt,
        endAt,
        excludeAppointmentId: parsed.data.exclude_id,
      },
      { serviceClient: service, encryptionKey },
    )

    if (hit) {
      return NextResponse.json({
        conflict: true,
        with: {
          appointment_id: hit.appointmentId,
          patient_name: hit.patientName,
          procedure_label: hit.procedureLabel,
          start_at: hit.startAt,
          end_at: hit.endAt,
        },
      })
    }

    return NextResponse.json({ conflict: false })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/atendimentos/check-conflict' })
  }
}
