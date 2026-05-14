import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { cancelScheduleBlock } from '@/lib/core/schedule-blocks/cancel'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const idSchema = z.string().uuid()

/**
 * DELETE /api/agenda/bloqueios/{id}
 * Soft delete (deleted_at + deleted_by). Admin e recepcionista podem
 * cancelar qualquer bloqueio do tenant.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/agenda/bloqueios/${params.id}`
  try {
    const session = await requireRole(
      ['admin', 'recepcionista', 'financeiro', 'profissional_saude'],
      { entity: 'schedule_blocks', entityId: params.id, route, request: req },
    )
    if (!idSchema.safeParse(params.id).success) {
      return NextResponse.json(
        { error: { code: 'INVALID_ID', message: 'id deve ser UUID' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await cancelScheduleBlock(supabase, {
      tenantId: session.tenantId,
      blockId: params.id,
      actorUserId: session.userId,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
