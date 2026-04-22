import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTreatmentPlans } from '@/lib/core/treatment-plans/list'
import { createTreatmentPlan } from '@/lib/core/treatment-plans/create'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/planos`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'treatment_plans', route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const plans = await listTreatmentPlans(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json(plans, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/planos`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'treatment_plans',
      route,
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
    const plan = await createTreatmentPlan(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      patientId: params.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
    })
    return NextResponse.json(plan, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
