import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  attachMaterialsToAppointment,
  listAppointmentMaterials,
} from '@/lib/core/appointments/materials'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * /api/atendimentos/[id]/materiais — Feature 007.
 *
 * POST anexa materiais (TUSS tabela 19) a um atendimento existente,
 * desde que o atendimento nao esteja cancelado.
 * GET lista os materiais ja anexados ao atendimento.
 *
 * Tenant isolation: a RPC ja valida jwt_tenant_id() ou trusta o
 * service-role; route handler chama requireRole.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  materiais: z
    .array(
      z
        .object({
          // Feature 045: material pode vir do catálogo (material_id) ou ser
          // livre (material_name), com TUSS opcional. Pelo menos um
          // identificador deve estar presente.
          tuss_code: z.string().min(1).max(20).nullable().optional(),
          tuss_description: z.string().min(1).max(500).nullable().optional(),
          material_id: z.string().uuid().nullable().optional(),
          material_name: z.string().min(1).max(200).nullable().optional(),
          quantity: z.number().int().positive().default(1),
          unit_cost_cents: z.number().int().min(0).optional(),
        })
        .refine((m) => Boolean(m.tuss_code || m.material_id || m.material_name), {
          message: 'Informe material do catálogo, insumo livre ou código TUSS.',
        }),
    )
    .min(1)
    .max(50),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'recepcionista', 'profissional_saude'], {
      entity: 'appointment_materials',
      route: `/api/atendimentos/${params.id}/materiais`,
      request: req,
    })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
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
    const result = await attachMaterialsToAppointment(supabase, {
      appointmentId: params.id,
      tenantId: session.tenantId,
      actorUserId: session.userId,
      materials: parsed.data.materiais.map((m) => ({
        tussCode: m.tuss_code ?? null,
        tussDescription: m.tuss_description ?? null,
        materialId: m.material_id ?? null,
        materialName: m.material_name ?? null,
        quantity: m.quantity,
        unitCostCents: m.unit_cost_cents,
      })),
    })

    return NextResponse.json(
      {
        appointment_id: result.appointmentId,
        materials: result.materials.map((m) => ({
          id: m.id,
          name: m.name,
          tuss_code: m.tussCode,
          tuss_description: m.tussDescription,
          material_id: m.materialId,
          quantity: m.quantity,
          unit_cost_cents: m.unitCostCents,
          total_cost_cents: m.totalCostCents,
          cost_pending: m.costPending,
          created_at: m.createdAt,
        })),
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/atendimentos/${params.id}/materiais` })
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'recepcionista', 'profissional_saude'], {
      entity: 'appointment_materials',
      route: `/api/atendimentos/${params.id}/materiais`,
      request: req,
    })

    const supabase = createSupabaseServiceClient()
    const materials = await listAppointmentMaterials(supabase, {
      appointmentId: params.id,
      tenantId: session.tenantId,
    })

    return NextResponse.json({
      materials: materials.map((m) => ({
        id: m.id,
        name: m.name,
        tuss_code: m.tussCode,
        tuss_description: m.tussDescription,
        material_id: m.materialId,
        quantity: m.quantity,
        unit_cost_cents: m.unitCostCents,
        total_cost_cents: m.totalCostCents,
        cost_pending: m.costPending,
        created_at: m.createdAt,
        created_by: m.createdBy,
      })),
    })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/atendimentos/${params.id}/materiais` })
  }
}
