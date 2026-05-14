import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { removeAssistant } from '@/lib/core/appointment-assistants/remove'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * PATCH /api/atendimentos/{id}/assistants/{assistantId} — soft-unlink
 * (Constitution I): RPC seta `removed_at`/`removed_by`. Body vazio porque
 * a única ação suportada é remover.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; assistantId: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/assistants/${params.assistantId}`
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'appointment_assistants',
      entityId: params.assistantId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await removeAssistant(supabase, {
      tenantId: session.tenantId,
      assistantRowId: params.assistantId,
      actorUserId: session.userId,
    })
    return NextResponse.json({ ok: true, removed_at: new Date().toISOString() }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
