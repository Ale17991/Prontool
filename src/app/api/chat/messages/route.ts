import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listChatMessages, postChatMessage } from '@/lib/core/chat/crud'
import { getUserProfile } from '@/lib/core/user-profile/read'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROLES = ['admin', 'financeiro', 'recepcionista', 'profissional_saude'] as const

const postSchema = z.object({
  kind: z.enum(['text', 'nudge']).default('text'),
  content: z.string().max(4000).optional(),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/chat/messages'
  try {
    const session = await requireRole([...ROLES], { entity: 'chat_messages', route, request: req })
    const supabase = createSupabaseServiceClient()
    const messages = await listChatMessages(supabase, { tenantId: session.tenantId })
    return NextResponse.json({ messages, me: session.userId }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/chat/messages'
  try {
    const session = await requireRole([...ROLES], { entity: 'chat_messages', route, request: req })
    const parsed = postSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const profile = await getUserProfile(supabase, session.userId, session.email ?? null).catch(
      () => null,
    )
    const fromName = profile?.fullName || session.email || 'Usuário'

    const message = await postChatMessage(supabase, {
      tenantId: session.tenantId,
      userId: session.userId,
      fromName,
      kind: parsed.data.kind,
      content: parsed.data.content,
    })
    return NextResponse.json({ message }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
