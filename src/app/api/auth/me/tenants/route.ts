import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getAvailableTenants } from '@/lib/auth/available-tenants'
import { toHttpResponse } from '@/lib/observability/http'
import { TENANT_ROLES_ORDERED } from '@/lib/core/team/types'
import type { Database, TenantRole } from '@/lib/db/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Feature 010 (US3) — GET /api/auth/me/tenants
 *
 * Lista as clínicas ativas vinculadas ao usuário, marcando isCurrent
 * para a que está ativa no JWT da sessão. Usado pelo /selecionar-clinica
 * e pelo dashboard-shell (decisão "mostrar Trocar clínica?").
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(TENANT_ROLES_ORDERED as readonly TenantRole[], {
      entity: 'session',
      route: 'GET /api/auth/me/tenants',
      request: req,
    })

    const supabaseService = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
    const tenants = await getAvailableTenants(supabaseService, session.userId)
    return NextResponse.json({
      tenants: tenants.map((t) => ({
        ...t,
        isCurrent: t.tenantId === session.tenantId,
      })),
    })
  } catch (err) {
    return toHttpResponse(err, { route: 'GET /api/auth/me/tenants' })
  }
}
