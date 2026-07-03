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
      z.object({
        tuss_code: z.string().min(1).max(20),
        tuss_description: z.string().min(1).max(500),
        quantity: z.number().int().positive().default(1),
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
        tussCode: m.tuss_code,
        tussDescription: m.tuss_description,
        quantity: m.quantity,
      })),
    })

    return NextResponse.json(
      {
        appointment_id: result.appointmentId,
        materials: result.materials.map((m) => ({
          id: m.id,
          tuss_code: m.tussCode,
          tuss_description: m.tussDescription,
          quantity: m.quantity,
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
        tuss_code: m.tussCode,
        tuss_description: m.tussDescription,
        quantity: m.quantity,
        created_at: m.createdAt,
        created_by: m.createdBy,
      })),
    })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/atendimentos/${params.id}/materiais` })
  }
}
