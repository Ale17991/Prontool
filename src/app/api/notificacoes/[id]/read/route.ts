import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { markNotificationRead } from '@/lib/core/notifications/mark-read'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'notifications',
        entityId: params.id,
        route: `/api/notificacoes/${params.id}/read`,
        request: req,
      },
    )
    const supabase = createSupabaseServiceClient()
    try {
      const data = await markNotificationRead(supabase, {
        tenantId: session.tenantId,
        userId: session.userId,
        id: params.id,
      })
      return NextResponse.json(data, { status: 200 })
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notificação não encontrada.' } },
          { status: 404 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: `/api/notificacoes/${params.id}/read` })
  }
}
