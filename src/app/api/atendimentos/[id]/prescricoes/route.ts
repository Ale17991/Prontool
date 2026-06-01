import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { recordPrescriptionIssued } from '@/lib/core/integrations/memed/record-prescription'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/atendimentos/{id}/prescricoes → registra a emissão de uma
 * prescrição (evento `prescricaoImpressa`). Idempotente por
 * (tenant, memed_prescription_id). requireRole admin/profissional_saude.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  memed_prescription_id: z.string().min(1),
  doctor_id: z.string().uuid(),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/prescricoes`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'prescription_records',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()

    const { data: appt, error } = await supabase
      .from('appointments')
      .select('patient_id')
      .eq('tenant_id', session.tenantId)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(`failed to load appointment: ${error.message}`)
    if (!appt) throw new NotFoundError('appointment', params.id)

    const result = await recordPrescriptionIssued({
      supabase,
      tenantId: session.tenantId,
      appointmentId: params.id,
      patientId: (appt as { patient_id: string }).patient_id,
      doctorId: parsed.data.doctor_id,
      memedPrescriptionId: parsed.data.memed_prescription_id,
      actorUserId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(
      { id: result.id, created: result.created },
      { status: result.created ? 201 : 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
