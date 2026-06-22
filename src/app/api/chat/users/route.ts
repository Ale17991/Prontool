import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTeamMembers } from '@/lib/core/team/list'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROLES = ['admin', 'financeiro', 'recepcionista', 'profissional_saude'] as const

/**
 * GET /api/chat/users — usuários ativos da clínica para as conversas 1:1.
 * Exclui o próprio usuário e convites pendentes/desativados.
 */
export async function GET(req: Request): Promise<Response> {
  const route = '/api/chat/users'
  try {
    const session = await requireRole([...ROLES], { entity: 'chat_users', route, request: req })
    const supabase = createSupabaseServiceClient()
    const members = await listTeamMembers(supabase, {
      tenantId: session.tenantId,
      requesterId: session.userId,
    })
    const users = members
      .filter((m) => m.status === 'active' && !m.isSelf)
      .map((m) => ({ id: m.userId, name: m.fullName || m.email }))
    return NextResponse.json({ users }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
