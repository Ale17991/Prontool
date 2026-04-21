import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { softDeleteExpense } from '@/lib/core/expenses/soft-delete'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * DELETE /api/despesas/{id} — soft-delete (admin only).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'expenses',
      entityId: params.id,
      route: `/api/despesas/${params.id}`,
      request: req,
    })

    const supabase = createSupabaseServiceClient()
    await softDeleteExpense(supabase, {
      id: params.id,
      tenantId: session.tenantId,
      actorUserId: session.userId,
    })
    return new Response(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/despesas/${params.id}` })
  }
}
