import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createIntakeToken } from '@/lib/core/patient-intake'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/pacientes/{id}/link-cadastro — gera um link de auto-cadastro
 * (token de uso único) para enviar ao paciente. Backlog 1/3.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/link-cadastro`
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'patient_intake_tokens',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const { token } = await createIntakeToken(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
    })
    return NextResponse.json({ token, path: `/completar-cadastro/${token}` }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
