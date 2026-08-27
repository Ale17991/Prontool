import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { deleteProgressPhoto } from '@/lib/core/patients/progress-photos'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; photoId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/fotos-evolucao/${params.photoId}`
  try {
    const session = await requireRole(['admin', 'recepcionista', 'profissional_saude'], {
      entity: 'patients',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await deleteProgressPhoto(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      photoId: params.photoId,
      actorUserId: session.userId,
    })
    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
