import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { updateTax } from '@/lib/core/taxes/update'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'
import { bpsToPercent } from '@/lib/validation/rate-bps'

/**
 * Feature 011 — PATCH /api/impostos/{id} (admin/financeiro).
 *
 * Apenas rate_bps, description e is_active são editáveis (defesa em camadas:
 * Zod + trigger DB). Name/category são imutáveis no DB e omitidos do schema.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z
  .object({
    rate_bps: z.number().int().min(0).max(10000).optional(),
    description: z.string().max(500).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'pelo menos um campo é obrigatório',
  })

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'taxes',
      entityId: params.id,
      route: `/api/impostos/${params.id}`,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload inválido',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    try {
      const updated = await updateTax(supabase, {
        tenantId: session.tenantId,
        id: params.id,
        rateBps: parsed.data.rate_bps,
        description: parsed.data.description,
        isActive: parsed.data.is_active,
      })
      return NextResponse.json(
        { ...updated, rate_percent: bpsToPercent(updated.rate_bps) },
        { status: 200 },
      )
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: 'TAX_NOT_FOUND', message: 'Imposto não encontrado.' } },
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
    return toHttpResponse(err, { route: `/api/impostos/${params.id}` })
  }
}
