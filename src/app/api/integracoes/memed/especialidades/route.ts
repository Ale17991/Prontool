import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { listMemedSpecialtiesPublic } from '@/lib/core/integrations/memed/list-specialties'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/integracoes/memed/especialidades → catálogo de especialidades da
 * Memed `[{ id, nome }]`. Fonte ÚNICA da especialidade do médico — vem do
 * endpoint PÚBLICO da Memed (independe de a clínica estar conectada). Leitura
 * por quem gerencia/lê médicos.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/integracoes/memed/especialidades'

export async function GET(req: Request): Promise<Response> {
  try {
    await requireRole(['admin', 'financeiro', 'recepcionista', 'profissional_saude'], {
      entity: 'doctors',
      route: ROUTE,
      request: req,
    })
    const especialidades = await listMemedSpecialtiesPublic()
    return NextResponse.json({ especialidades }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
