import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { ValidationError } from '@/lib/observability/errors'
import { deleteUserAvatar, uploadUserAvatar } from '@/lib/core/user-profile/upload-avatar'
import { MAX_AVATAR_BYTES } from '@/lib/core/user-profile/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ANY_ROLE = ['admin', 'financeiro', 'recepcionista', 'profissional_saude'] as const

function clientContext(req: Request) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(ANY_ROLE, {
      entity: 'user_profile',
      route: '/api/configuracoes/perfil/avatar',
      request: req,
    })

    const contentLength = Number(req.headers.get('content-length') ?? '0')
    if (contentLength > 0 && contentLength > MAX_AVATAR_BYTES * 1.05) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Avatar excede 2 MB' } },
        { status: 413 },
      )
    }

    const formData = await req.formData()
    const file = formData.get('avatar')
    if (!(file instanceof File)) {
      throw new ValidationError('Campo `avatar` ausente ou inválido', { reason: 'missing_field' })
    }

    const supabase = createSupabaseServiceClient()
    const { ip, userAgent } = clientContext(req)
    const avatar = await uploadUserAvatar(
      supabase,
      session.userId,
      session.email,
      session.tenantId,
      file,
      { ip, userAgent },
    )
    return NextResponse.json({ avatar })
  } catch (err) {
    if (
      err instanceof ValidationError &&
      (err.meta as { reason?: string } | undefined)?.reason === 'payload_too_large'
    ) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: err.message } },
        { status: 413 },
      )
    }
    return toHttpResponse(err, { route: '/api/configuracoes/perfil/avatar', method: 'POST' })
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const session = await requireRole(ANY_ROLE, {
      entity: 'user_profile',
      route: '/api/configuracoes/perfil/avatar',
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const { ip, userAgent } = clientContext(req)
    await deleteUserAvatar(supabase, session.userId, session.email, session.tenantId, {
      ip,
      userAgent,
    })
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/perfil/avatar', method: 'DELETE' })
  }
}
