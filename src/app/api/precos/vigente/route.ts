import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { tryResolvePrice } from '@/lib/core/pricing/resolve-price'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/precos/vigente?procedure_id=X&plan_id=Y
 *
 * Retorna o preço vigente hoje para a combinação — ou `{ amountCents: null }`
 * se não houver registro em price_versions. Usado pelo form de etapa do
 * plano de tratamento para sugerir valor estimado ao usuário sem que a
 * ausência de preço seja um erro.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  procedure_id: z.string().uuid(),
  plan_id: z.string().uuid(),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/precos/vigente'
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'price_versions', route, request: req },
    )

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_QUERY',
            message: 'Parâmetros inválidos',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const found = await tryResolvePrice(supabase, {
      tenantId: session.tenantId,
      procedureId: parsed.data.procedure_id,
      planId: parsed.data.plan_id,
      asOf: new Date(),
    })
    return NextResponse.json(
      {
        amountCents: found?.amountCents ?? null,
        priceVersionId: found?.priceVersionId ?? null,
        validFrom: found?.validFrom ?? null,
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
