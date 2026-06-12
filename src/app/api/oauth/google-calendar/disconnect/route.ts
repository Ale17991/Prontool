import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { TENANT_ROLES_ORDERED } from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { deleteGoogleConnection } from '@/lib/integrations/google-calendar/oauth/token-store'

/**
 * POST /api/oauth/google-calendar/disconnect
 * Desconecta a agenda Google do próprio usuário (apaga os tokens).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const route = '/api/oauth/google-calendar/disconnect'
  try {
    const session = await requireRole(TENANT_ROLES_ORDERED as readonly TenantRole[], {
      entity: 'user_integrations',
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await deleteGoogleConnection(supabase, session.userId, session.tenantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
