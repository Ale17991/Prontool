import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPatient } from '@/lib/core/patients/get'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET   /api/pacientes/{id} — detalhe + sumário financeiro agregado.
 * PATCH /api/pacientes/{id} — atualiza campos mutáveis (hoje só plan_id).
 *                             Admin/recepcionista apenas.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  plan_id: z.string().uuid().nullable(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'patients',
        entityId: params.id,
        route: `/api/pacientes/${params.id}`,
        request: req,
      },
    )
    const supabase = createSupabaseServiceClient()
    const result = await getPatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/pacientes/${params.id}` })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}`
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'patients',
      entityId: params.id,
      route,
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

    // Se plan_id foi informado, valida que pertence ao tenant.
    if (parsed.data.plan_id) {
      const hp = await supabase
        .from('health_plans')
        .select('id')
        .eq('tenant_id', session.tenantId)
        .eq('id', parsed.data.plan_id)
        .maybeSingle()
      if (hp.error) throw new Error(`health plan lookup: ${hp.error.message}`)
      if (!hp.data) throw new NotFoundError('health_plan', parsed.data.plan_id)
    }

    const update = await supabase
      .from('patients')
      .update({ plan_id: parsed.data.plan_id })
      .eq('tenant_id', session.tenantId)
      .eq('id', params.id)
      .select('id')
      .maybeSingle()
    if (update.error) throw new Error(`patient patch: ${update.error.message}`)
    if (!update.data) throw new NotFoundError('patient', params.id)

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
