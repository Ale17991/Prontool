import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPriceHistory } from '@/lib/core/pricing/history'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T113 — GET /api/precos/versions/{id}/history. Devolve a chain
 * completa para a combinação (procedure, plan) à qual a versão `id`
 * pertence.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro', 'recepcionista'], {
      entity: 'price_versions',
      entityId: params.id,
      route: `/api/precos/versions/${params.id}/history`,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const chain = await getPriceHistory(supabase, {
      tenantId: session.tenantId,
      versionId: params.id,
    })
    return NextResponse.json(
      chain.map((v) => ({
        id: v.id,
        procedure_id: v.procedureId,
        plan_id: v.planId,
        amount_cents: v.amountCents,
        valid_from: v.validFrom,
        created_at: v.createdAt,
        created_by: v.createdBy,
        reason: v.reason,
        previous_version_id: v.previousVersionId,
      })),
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/precos/versions/${params.id}/history` })
  }
}
