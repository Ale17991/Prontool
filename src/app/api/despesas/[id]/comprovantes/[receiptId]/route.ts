import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { softDeleteReceipt } from '@/lib/core/expenses/soft-delete-receipt'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Soft-delete de um comprovante. Admin only.
 * DELETE /api/despesas/[id]/comprovantes/[receiptId]
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; receiptId: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'expenses',
      entityId: params.id,
      route: `/api/despesas/${params.id}/comprovantes/${params.receiptId}`,
      request: req,
    })

    const body = (await req.json().catch(() => ({}))) as { reason?: string }

    const supabase = createSupabaseServiceClient()
    await softDeleteReceipt(supabase, {
      tenantId: session.tenantId,
      receiptId: params.receiptId,
      actorUserId: session.userId,
      reason: body.reason ?? null,
    })

    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, {
      route: `/api/despesas/${params.id}/comprovantes/${params.receiptId}`,
    })
  }
}
