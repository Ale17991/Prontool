import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { linkDoctorUser } from '@/lib/core/doctors/link-user'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/medicos/{id}/usuario → vincula (ou desvincula) o profissional a uma
 * conta de login. Admin-only. Body `{ user_id: string | null }`.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({ user_id: z.string().uuid().nullable() })

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/medicos/${params.id}/usuario`
  try {
    const session = await requireRole(['admin'], {
      entity: 'doctors',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'user_id inválido (uuid ou null).' } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await linkDoctorUser(supabase, {
      tenantId: session.tenantId,
      doctorId: params.id,
      userId: parsed.data.user_id,
    })
    return NextResponse.json({ ok: true, user_id: parsed.data.user_id })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
