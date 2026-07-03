import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPerioExams } from '@/lib/core/dental/perio/list-exams'
import { createPerioExam } from '@/lib/core/dental/perio/create-exam'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  examDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  dentition: z.enum(['permanent', 'deciduous']).optional(),
  appointmentId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

/** Lista os exames periodontais do paciente (+ id do rascunho aberto). */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/periograma`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'perio_exams', entityId: params.id, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const data = await listPerioExams(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

/** Cria um exame periodontal em rascunho. */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/periograma`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'perio_exams',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await createPerioExam(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      examDate: parsed.data.examDate ?? null,
      dentition: parsed.data.dentition,
      appointmentId: parsed.data.appointmentId ?? null,
      notes: parsed.data.notes ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
