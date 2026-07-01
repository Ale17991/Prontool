import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listHealthPlans } from '@/lib/core/plans/list'
import { createHealthPlan } from '@/lib/core/plans/create'
import { ConflictError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T165 — GET / POST /api/planos. Leitura pra todos com `plan.read`;
 * POST/PATCH só admin.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  include_inactive: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
})
const createSchema = z.object({ name: z.string().min(1) })

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'health_plans', route: '/api/planos', request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const list = await listHealthPlans(supabase, {
      tenantId: session.tenantId,
      includeInactive: parsed.data.include_inactive,
    })
    return NextResponse.json(list, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/planos' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'health_plans',
      route: '/api/planos',
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'name é obrigatório' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    try {
      const created = await createHealthPlan(supabase, {
        tenantId: session.tenantId,
        name: parsed.data.name,
      })
      return NextResponse.json(
        {
          id: created.id,
          name: created.name,
          active: created.active,
          created_at: created.createdAt,
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
    return toHttpResponse(err, { route: '/api/planos' })
  }
}
