import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createExamRequest, listExamRequests } from '@/lib/core/exam-requests/crud'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const postSchema = z.object({
  items: z
    .array(
      z.object({
        code: z.string().trim().max(16).nullable().optional(),
        description: z.string().trim().min(1).max(300),
      }),
    )
    .min(1)
    .max(50),
  clinical_indication: z.string().trim().max(4000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  appointment_id: z.string().uuid().nullable().optional(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/solicitacoes-exame`
  try {
    const session = await requireRole(
      ['admin', 'profissional_saude', 'recepcionista'],
      { entity: 'exam_requests', entityId: params.id, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const rows = await listExamRequests(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json({ rows }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/solicitacoes-exame`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'exam_requests',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = postSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await createExamRequest(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      items: parsed.data.items.map((i) => ({ code: i.code ?? null, description: i.description })),
      clinicalIndication: parsed.data.clinical_indication ?? null,
      notes: parsed.data.notes ?? null,
      appointmentId: parsed.data.appointment_id ?? null,
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
