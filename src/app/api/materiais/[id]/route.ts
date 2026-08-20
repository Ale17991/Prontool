import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { updateMaterial } from '@/lib/core/materials-catalog'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 045 — PATCH /api/materiais/{id} (admin/financeiro).
 *
 * Edita nome, custo unitário e situação (ativar/desativar). Não altera
 * custos já congelados em atendimentos passados — o snapshot vive em
 * appointment_materials. O código TUSS é imutável (omitido do schema).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    unit_cost_cents: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'pelo menos um campo é obrigatório' })

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'tenant_materials',
      entityId: params.id,
      route: `/api/materiais/${params.id}`,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
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
      const updated = await updateMaterial(supabase, {
        tenantId: session.tenantId,
        id: params.id,
        name: parsed.data.name,
        unitCostCents: parsed.data.unit_cost_cents,
        active: parsed.data.active,
        actorUserId: session.userId,
      })
      return NextResponse.json(
        {
          id: updated.id,
          name: updated.name,
          unit_cost_cents: updated.unitCostCents,
          tuss_code: updated.tussCode,
          active: updated.active,
          updated_at: updated.updatedAt,
        },
        { status: 200 },
      )
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: 'MATERIAL_NOT_FOUND', message: 'Insumo não encontrado.' } },
          { status: 404 },
        )
      }
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
    return toHttpResponse(err, { route: `/api/materiais/${params.id}` })
  }
}
