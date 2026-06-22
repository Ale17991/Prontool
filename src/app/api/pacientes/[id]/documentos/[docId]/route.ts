import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { setPatientDocumentDelivered } from '@/lib/core/patient-documents/set-delivered'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  delivered: z.boolean(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; docId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/documentos/${params.docId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'patient_documents',
      entityId: params.docId,
      route,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await setPatientDocumentDelivered(supabase, {
      tenantId: session.tenantId,
      documentId: params.docId,
      delivered: parsed.data.delivered,
      actorUserId: session.userId,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
