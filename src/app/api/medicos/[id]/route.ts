import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getDoctor } from '@/lib/core/doctors/get'
import { updateDoctor } from '@/lib/core/doctors/update'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T127 — GET /api/medicos/{id} + PATCH /api/medicos/{id}. Apenas
 * `full_name` e `active` podem mudar; CRM é imutável.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  active: z.boolean().optional(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'doctors',
        entityId: params.id,
        route: `/api/medicos/${params.id}`,
        request: req,
      },
    )
    const supabase = createSupabaseServiceClient()
    const doctor = await getDoctor(supabase, {
      tenantId: session.tenantId,
      doctorId: params.id,
    })
    return NextResponse.json(
      {
        id: doctor.id,
        full_name: doctor.fullName,
        crm: doctor.crm,
        external_identifier: doctor.externalIdentifier,
        active: doctor.active,
        created_at: doctor.createdAt,
        current_percentage_bps: doctor.currentPercentageBps,
        current_valid_from: doctor.currentValidFrom,
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/medicos/${params.id}` })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'doctors',
      entityId: params.id,
      route: `/api/medicos/${params.id}`,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Apenas full_name e active podem mudar' } },
        { status: 400 },
      )
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Nada para atualizar' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const updated = await updateDoctor(supabase, {
      tenantId: session.tenantId,
      doctorId: params.id,
      patch: {
        ...(parsed.data.full_name !== undefined ? { fullName: parsed.data.full_name } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      },
    })
    return NextResponse.json(
      { id: updated.id, full_name: updated.fullName, active: updated.active },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/medicos/${params.id}` })
  }
}
