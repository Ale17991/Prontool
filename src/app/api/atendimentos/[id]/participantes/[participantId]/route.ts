import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { removeAssistant } from '@/lib/core/appointment-assistants/remove'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * DELETE /api/atendimentos/{id}/participantes/{participantId} — soft-unlink
 * de uma participação ativa (feature 031). Reusa a RPC
 * `remove_appointment_assistant` (0085) — mesma tabela append-only.
 * RBAC: admin/financeiro.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; participantId: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/participantes/${params.participantId}`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'appointment_assistants',
      entityId: params.participantId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await removeAssistant(supabase, {
      tenantId: session.tenantId,
      assistantRowId: params.participantId,
      actorUserId: session.userId,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
