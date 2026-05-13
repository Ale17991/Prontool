import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { markAllNotificationsRead } from '@/lib/core/notifications/mark-all-read'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'notifications', route: '/api/notificacoes/mark-all-read', request: req },
    )
    const supabase = createSupabaseServiceClient()
    const data = await markAllNotificationsRead(supabase, {
      tenantId: session.tenantId,
      userId: session.userId,
    })
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/notificacoes/mark-all-read' })
  }
}
