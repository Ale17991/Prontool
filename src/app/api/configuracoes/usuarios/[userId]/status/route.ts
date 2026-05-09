import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { setTeamMemberStatus } from '@/lib/core/team/set-status'
import { listTeamMembers } from '@/lib/core/team/list'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(
  req: Request,
  { params }: { params: { userId: string } },
): Promise<Response> {
  const route = `/api/configuracoes/usuarios/${params.userId}/status`
  try {
    const session = await requireRole(['admin'], {
      entity: 'user_tenants',
      entityId: params.userId,
      route,
      request: req,
    })
    const body = (await req.json()) as unknown
    const supabase = createSupabaseServiceClient()
    await setTeamMemberStatus(
      supabase,
      session.tenantId,
      session.userId,
      session.email,
      params.userId,
      body,
      {
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
      },
    )
    const users = await listTeamMembers(supabase, {
      tenantId: session.tenantId,
      requesterId: session.userId,
    })
    const updated = users.find((u) => u.userId === params.userId)
    return NextResponse.json({ user: updated ?? null })
  } catch (err) {
    return toHttpResponse(err, { route, method: 'PATCH' })
  }
}
