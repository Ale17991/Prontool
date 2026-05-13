import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { updatePlanActive } from '@/lib/core/plans/update-active'
import { updatePlanTaxRate } from '@/lib/core/plans/update-tax-rate'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'
import { bpsToPercent } from '@/lib/validation/rate-bps'

/**
 * PATCH /api/planos/{id}. Admin-only. Suporta:
 *   - `active`: ativar/desativar plano (renomear continua proibido por design).
 *   - `tax_rate_bps` (Feature 011 — US2): alíquota tributária retida pelo
 *     convênio em basis points (0..10000). Mudança auditada via trigger
 *     `health_plans_tax_rate_audit`.
 *
 * Body deve ter ao menos um dos dois campos. Aplicação dos updates é
 * sequencial; resposta consolidada vem do último update aplicado.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z
  .object({
    active: z.boolean().optional(),
    tax_rate_bps: z.number().int().min(0).max(10000).optional(),
  })
  .refine((d) => d.active !== undefined || d.tax_rate_bps !== undefined, {
    message: 'pelo menos um campo (active ou tax_rate_bps) é obrigatório',
  })

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'health_plans',
      entityId: params.id,
      route: `/api/planos/${params.id}`,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Apenas `active` e `tax_rate_bps` podem ser alterados',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    try {
      let finalState:
        | { id: string; name: string; active: boolean; tax_rate_bps?: number }
        | null = null

      if (parsed.data.active !== undefined) {
        finalState = await updatePlanActive(supabase, {
          tenantId: session.tenantId,
          planId: params.id,
          active: parsed.data.active,
        })
      }
      if (parsed.data.tax_rate_bps !== undefined) {
        finalState = await updatePlanTaxRate(supabase, {
          tenantId: session.tenantId,
          planId: params.id,
          taxRateBps: parsed.data.tax_rate_bps,
        })
      }

      // Garante consistência: se só active foi enviado, busca tax_rate_bps
      // atual para devolver no DTO. Se só tax_rate_bps, finalState já tem.
      let taxRateBps = (finalState as { tax_rate_bps?: number } | null)?.tax_rate_bps
      if (taxRateBps === undefined) {
        const { data } = await supabase
          .from('health_plans')
          .select('tax_rate_bps')
          .eq('id', params.id)
          .eq('tenant_id', session.tenantId)
          .single()
        taxRateBps = (data as { tax_rate_bps?: number } | null)?.tax_rate_bps ?? 0
      }

      return NextResponse.json(
        {
          ...finalState,
          tax_rate_bps: taxRateBps,
          tax_rate_percent: bpsToPercent(taxRateBps),
        },
        { status: 200 },
      )
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: 'PLAN_NOT_FOUND', message: 'Convênio não encontrado.' } },
          { status: 404 },
        )
      }
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: 400 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: `/api/planos/${params.id}` })
  }
}
