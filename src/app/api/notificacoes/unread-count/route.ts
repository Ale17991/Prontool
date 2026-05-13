import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { unreadNotificationsSummary } from '@/lib/core/notifications/unread-count'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 012 — US2 — rota leve para o badge do sininho.
 * NÃO invoca geração; só conta.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'notifications', route: '/api/notificacoes/unread-count', request: req },
    )
    const supabase = createSupabaseServiceClient()
    const summary = await unreadNotificationsSummary(supabase, {
      tenantId: session.tenantId,
      userId: session.userId,
    })
    return NextResponse.json(summary, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/notificacoes/unread-count' })
  }
}
