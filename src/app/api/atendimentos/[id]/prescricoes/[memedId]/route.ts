import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { recordPrescriptionDeleted } from '@/lib/core/integrations/memed/record-prescription'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * PATCH /api/atendimentos/{id}/prescricoes/{memedId} → registra a exclusão
 * de uma prescrição (evento `prescricaoExcluida`): transição issued→deleted.
 * Idempotente. requireRole admin/profissional_saude.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; memedId: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/prescricoes/${params.memedId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'prescription_records',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await recordPrescriptionDeleted({
      supabase,
      tenantId: session.tenantId,
      memedPrescriptionId: params.memedId,
      actorUserId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
