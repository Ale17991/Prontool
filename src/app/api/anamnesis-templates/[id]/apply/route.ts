import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { applyAnamnesisToPatient } from '@/lib/core/anamnesis/apply-to-patient'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const applySchema = z.object({
  patient_id: z.string().uuid(),
  responses: z.record(z.unknown()),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/anamnesis-templates/${params.id}/apply`
  try {
    const session = await requireRole(['admin'], {
      entity: 'anamnesis_templates',
      entityId: params.id,
      route,
      request: req,
    })

    const parsed = applySchema.safeParse(await req.json().catch(() => null))
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
    const record = await applyAnamnesisToPatient(supabase, {
      tenantId: session.tenantId,
      patientId: parsed.data.patient_id,
      templateId: params.id,
      responses: parsed.data.responses,
      actorUserId: session.userId,
    })
    return NextResponse.json(record, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
