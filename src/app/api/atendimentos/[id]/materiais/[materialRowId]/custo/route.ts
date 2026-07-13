import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { setAppointmentMaterialCost } from '@/lib/core/appointments/materials'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 045 — PATCH /api/atendimentos/{id}/materiais/{materialRowId}/custo.
 *
 * Completa ou corrige o custo (snapshot) de um material já lançado. Passa
 * pela RPC auditada `set_appointment_material_cost` (column-guard: só
 * `unit_cost_cents`/`material_id`). `reason` é obrigatório. Restrito a
 * admin/financeiro (Princípio II — auditoria; RBAC financeiro).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  unit_cost_cents: z.number().int().min(0),
  material_id: z.string().uuid().nullable().optional(),
  reason: z.string().min(1).max(500),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; materialRowId: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/materiais/${params.materialRowId}/custo`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'appointment_materials',
      entityId: params.materialRowId,
      route,
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
      const updated = await setAppointmentMaterialCost(supabase, {
        tenantId: session.tenantId,
        materialRowId: params.materialRowId,
        unitCostCents: parsed.data.unit_cost_cents,
        materialId: parsed.data.material_id ?? null,
        reason: parsed.data.reason,
        actorUserId: session.userId,
      })
      return NextResponse.json(
        { id: updated.id, unit_cost_cents: updated.unitCostCents },
        { status: 200 },
      )
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: 'MATERIAL_ROW_NOT_FOUND', message: 'Material não encontrado.' } },
          { status: 404 },
        )
      }
      if (err instanceof ValidationError) {
        return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: 400 })
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
