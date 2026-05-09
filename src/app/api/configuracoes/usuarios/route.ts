import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTeamMembers } from '@/lib/core/team/list'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'user_tenants',
      route: '/api/configuracoes/usuarios',
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const users = await listTeamMembers(supabase, {
      tenantId: session.tenantId,
      requesterId: session.userId,
    })
    return NextResponse.json({ users })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/usuarios', method: 'GET' })
  }
}
