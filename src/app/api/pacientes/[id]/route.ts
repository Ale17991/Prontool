import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPatient } from '@/lib/core/patients/get'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/pacientes/{id} — detalhe + sumário financeiro agregado.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'patients',
        entityId: params.id,
        route: `/api/pacientes/${params.id}`,
        request: req,
      },
    )
    const supabase = createSupabaseServiceClient()
    const result = await getPatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/pacientes/${params.id}` })
  }
}
