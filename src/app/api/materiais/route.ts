import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createMaterial, listMaterials } from '@/lib/core/materials-catalog'
import { ConflictError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 045 — catálogo de insumos por clínica.
 *
 * GET /api/materiais — lista insumos ativos (todos os papéis operacionais,
 * pois o seletor do atendimento precisa consultar). `include_inactive=true`
 * (só admin/financeiro faz sentido) traz também desativados para a tela de
 * gestão.
 * POST /api/materiais — cria insumo (admin/financeiro).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  include_inactive: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
})

const createSchema = z.object({
  name: z.string().min(1).max(200),
  unit_cost_cents: z.number().int().min(0),
  tuss_code: z.string().min(1).max(20).nullable().optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'tenant_materials', route: '/api/materiais', request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const materials = await listMaterials(supabase, {
      tenantId: session.tenantId,
      includeInactive: parsed.data.include_inactive,
    })
    return NextResponse.json(
      {
        materials: materials.map((m) => ({
          id: m.id,
          name: m.name,
          unit_cost_cents: m.unitCostCents,
          tuss_code: m.tussCode,
          active: m.active,
          updated_at: m.updatedAt,
        })),
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: '/api/materiais' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'tenant_materials',
      route: '/api/materiais',
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    try {
      const created = await createMaterial(supabase, {
        tenantId: session.tenantId,
        name: parsed.data.name,
        unitCostCents: parsed.data.unit_cost_cents,
        tussCode: parsed.data.tuss_code ?? null,
        actorUserId: session.userId,
      })
      return NextResponse.json(
        {
          id: created.id,
          name: created.name,
          unit_cost_cents: created.unitCostCents,
          tuss_code: created.tussCode,
          active: created.active,
          updated_at: created.updatedAt,
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
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: 400 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: '/api/materiais' })
  }
}
