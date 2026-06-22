import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { sendTeamMemberPasswordReset } from '@/lib/core/team/send-password-reset'
import { originFromHeaders } from '@/lib/core/app-url'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: { userId: string } },
): Promise<Response> {
  const route = `/api/configuracoes/usuarios/${params.userId}/redefinir-senha`
  try {
    const session = await requireRole(['admin'], {
      entity: 'user_tenants',
      entityId: params.userId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await sendTeamMemberPasswordReset(supabase, {
      tenantId: session.tenantId,
      actorId: session.userId,
      targetUserId: params.userId,
      baseUrl: originFromHeaders(req.headers),
    })
    return NextResponse.json({ ok: true, email: result.email }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
