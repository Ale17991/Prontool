import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { deleteAppointmentAttachment } from '@/lib/core/appointment-attachments'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; attId: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/anexos/${params.attId}`
  try {
    const session = await requireRole(['admin', 'recepcionista', 'profissional_saude'], {
      entity: 'appointment_attachments',
      entityId: params.attId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await deleteAppointmentAttachment(supabase, {
      tenantId: session.tenantId,
      id: params.attId,
      actorUserId: session.userId,
    })
    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
