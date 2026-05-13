import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createTax } from '@/lib/core/taxes/create'
import { listTaxes } from '@/lib/core/taxes/list'
import { ConflictError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 011 — GET /api/impostos (todos os papéis autenticados) +
 * POST /api/impostos (admin/financeiro).
 *
 * `listTaxes` esconde linhas com deleted_at; filtro `include_inactive=true`
 * traz também desativadas (default: só ativas).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  include_inactive: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  category: z.enum(['municipal', 'estadual', 'federal', 'outro']).optional(),
})

const createSchema = z.object({
  name: z.string().min(1).max(80),
  rate_bps: z.number().int().min(0).max(10000),
  category: z.enum(['municipal', 'estadual', 'federal', 'outro']),
  description: z.string().max(500).optional().nullable(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'taxes', route: '/api/impostos', request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const list = await listTaxes(supabase, {
      tenantId: session.tenantId,
      includeInactive: parsed.data.include_inactive,
      category: parsed.data.category,
    })
    return NextResponse.json(list, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/impostos' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'taxes',
      route: '/api/impostos',
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
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
      const created = await createTax(supabase, {
        tenantId: session.tenantId,
        name: parsed.data.name,
        rateBps: parsed.data.rate_bps,
        category: parsed.data.category,
        description: parsed.data.description ?? null,
        actorUserId: session.userId,
      })
      // bpsToPercent é derivado em listTaxes; replicamos aqui via re-fetch
      // simples seria custoso — calculamos inline.
      const { bpsToPercent } = await import('@/lib/validation/rate-bps')
      return NextResponse.json(
        {
          ...created,
          rate_percent: bpsToPercent(created.rate_bps),
        },
        { status: 201 },
      )
    } catch (err) {
      if (err instanceof ConflictError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: '/api/impostos' })
  }
}
