import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createManualUser } from '@/lib/core/team/create-manual'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 012 — US3 — POST /api/configuracoes/usuarios/manual.
 * Admin define senha + opcional vínculo a profissional. Email já confirmado.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'user_tenants',
      route: '/api/configuracoes/usuarios/manual',
      request: req,
    })
    const body = await req.json().catch(() => null)
    const supabase = createSupabaseServiceClient()
    try {
      const result = await createManualUser(
        supabase,
        session.tenantId,
        session.userId,
        session.email,
        body,
      )
      return NextResponse.json(
        {
          user_id: result.userId,
          email: result.email,
          role: result.role,
          linked_doctor: result.linkedDoctor,
        },
        { status: 201 },
      )
    } catch (err) {
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: { code: 'INVALID_BODY', message: err.message, meta: err.meta } },
          { status: 400 },
        )
      }
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: 'DOCTOR_NOT_FOUND', message: err.message } },
          { status: 404 },
        )
      }
      if (err instanceof ConflictError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: '/api/configuracoes/usuarios/manual' })
  }
}
