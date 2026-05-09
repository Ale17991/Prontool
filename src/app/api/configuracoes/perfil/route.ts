import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getUserProfile } from '@/lib/core/user-profile/read'
import { updateUserProfile } from '@/lib/core/user-profile/update'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ANY_ROLE = ['admin', 'financeiro', 'recepcionista', 'profissional_saude'] as const

function clientContext(req: Request) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(ANY_ROLE, {
      entity: 'user_profile',
      route: '/api/configuracoes/perfil',
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const profile = await getUserProfile(supabase, session.userId, session.email)
    return NextResponse.json(profile)
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/perfil', method: 'GET' })
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const session = await requireRole(ANY_ROLE, {
      entity: 'user_profile',
      route: '/api/configuracoes/perfil',
      request: req,
    })
    const body = (await req.json()) as unknown
    const supabase = createSupabaseServiceClient()
    const { ip, userAgent } = clientContext(req)
    const profile = await updateUserProfile(supabase, session.userId, session.email, body, {
      ip,
      userAgent,
    })
    return NextResponse.json(profile)
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/perfil', method: 'PUT' })
  }
}
