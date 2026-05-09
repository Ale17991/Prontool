import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resendInvite } from '@/lib/core/team/invite'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: { userId: string } },
): Promise<Response> {
  const route = `/api/configuracoes/usuarios/${params.userId}/reenviar-convite`
  try {
    const session = await requireRole(['admin'], {
      entity: 'user_tenants',
      entityId: params.userId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await resendInvite(supabase, session.tenantId, session.userId, session.email, params.userId, {
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent') ?? null,
    })
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route, method: 'POST' })
  }
}
