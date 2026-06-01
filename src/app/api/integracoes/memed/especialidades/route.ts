import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listMemedSpecialties } from '@/lib/core/integrations/memed/list-specialties'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/integracoes/memed/especialidades → catálogo de especialidades da
 * Memed `[{ id, nome }]` para o de-para ao habilitar prescritor (admin-only).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/integracoes/memed/especialidades'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_memed_config',
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const especialidades = await listMemedSpecialties(supabase, session.tenantId)
    return NextResponse.json({ especialidades }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
