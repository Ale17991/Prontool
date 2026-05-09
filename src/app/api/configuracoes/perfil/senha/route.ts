import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { changePassword } from '@/lib/core/user-profile/change-password'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ANY_ROLE = ['admin', 'financeiro', 'recepcionista', 'profissional_saude'] as const

const bodySchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual obrigatória'),
  newPassword: z.string().min(1, 'Nova senha obrigatória'),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(ANY_ROLE, {
      entity: 'user_profile',
      route: '/api/configuracoes/perfil/senha',
      request: req,
    })
    if (!session.email) {
      throw new ValidationError('Sessão sem e-mail — re-autentique', { reason: 'no_email' })
    }

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      throw new ValidationError(first?.message ?? 'invalid body')
    }

    // Usa o client da sessão (RLS-bound) para que `auth.updateUser` use a
    // sessão atual do cookie.
    const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

    await changePassword(
      supabase,
      session.userId,
      session.email,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      {
        tenantId: session.tenantId,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
      },
    )

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/perfil/senha', method: 'POST' })
  }
}
