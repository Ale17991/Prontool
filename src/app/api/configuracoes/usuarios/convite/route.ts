import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { inviteTeamMember } from '@/lib/core/team/invite'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'user_tenants',
      route: '/api/configuracoes/usuarios/convite',
      request: req,
    })
    const body = (await req.json()) as unknown
    const supabase = createSupabaseServiceClient()
    const result = await inviteTeamMember(
      supabase,
      session.tenantId,
      session.userId,
      session.email,
      body,
      {
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
      },
    )
    return NextResponse.json(
      {
        user: {
          userId: result.userId,
          email: result.email,
          role: result.role,
          status: 'pending' as const,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/usuarios/convite', method: 'POST' })
  }
}
