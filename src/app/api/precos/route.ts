import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPriceHeads } from '@/lib/core/pricing/list-heads'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T111 — GET /api/precos. Lista o head vigente de cada combinação
 * (procedure, plan) do tenant, com filtros opcionais e data de
 * referência (`as_of`, default hoje).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  procedure_id: z.string().uuid().optional(),
  plan_id: z.string().uuid().optional(),
  as_of: z.string().optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro', 'recepcionista'], {
      entity: 'price_versions',
      route: '/api/precos',
      request: req,
    })
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const heads = await listPriceHeads(supabase, {
      tenantId: session.tenantId,
      procedureId: parsed.data.procedure_id,
      planId: parsed.data.plan_id,
      asOf: parsed.data.as_of,
    })
    return NextResponse.json(heads, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/precos' })
  }
}
