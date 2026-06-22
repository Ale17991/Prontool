import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { updateTeamMemberProfile } from '@/lib/core/team/update-profile'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(20).nullable().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { userId: string } },
): Promise<Response> {
  const route = `/api/configuracoes/usuarios/${params.userId}/perfil`
  try {
    // Qualquer papel autenticado entra; a regra "admin OU próprio" é aplicada no core.
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'user_profile', entityId: params.userId, route, request: req },
    )
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await updateTeamMemberProfile(supabase, {
      tenantId: session.tenantId,
      actorId: session.userId,
      targetUserId: params.userId,
      fullName: parsed.data.full_name,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
