import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPayablesWithProjections } from '@/lib/core/accounts-payable'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.string().optional(),
  supplier: z.string().optional(),
  status: z.enum(['a_vencer', 'vencida', 'paga', 'all']).optional(),
  include_projections: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === undefined ? true : (v === true || v === 'true')),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/financeiro/contas-a-pagar'
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'expenses',
      route,
      request: req,
    })
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await listPayablesWithProjections(supabase, {
      tenantId: session.tenantId,
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
      category: parsed.data.category ?? null,
      supplierContains: parsed.data.supplier ?? null,
      status: parsed.data.status,
      includeProjections: parsed.data.include_projections,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
