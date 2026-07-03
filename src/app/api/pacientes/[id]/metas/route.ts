import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listGoals, setGoal, deactivateGoal } from '@/lib/core/patient-portal/goals'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Metas por métrica do paciente (Dash de Metas do portal).
 *  GET    → lista as metas ativas
 *  POST   → define/atualiza ({ metricType, direction, targetValue })
 *  DELETE → desativa (?metricType=)
 * RBAC: admin / profissional_saude.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/pacientes/[id]/metas'
const ROLES = ['admin', 'profissional_saude'] as const

const setSchema = z.object({
  metricType: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  direction: z.enum(['decrease', 'increase']),
  targetValue: z.number().finite(),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(ROLES, {
      entity: 'patient_metric_goals',
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const goals = await listGoals(supabase, session.tenantId, params.id)
    return NextResponse.json({ goals }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(ROLES, {
      entity: 'patient_metric_goals',
      route: ROUTE,
      request: req,
    })
    const parsed = setSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Dados da meta inválidos.' } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const created = await setGoal(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      metricType: parsed.data.metricType,
      direction: parsed.data.direction,
      targetValue: parsed.data.targetValue,
      actorUserId: session.userId,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(ROLES, {
      entity: 'patient_metric_goals',
      route: ROUTE,
      request: req,
    })
    const metricType = new URL(req.url).searchParams.get('metricType')
    if (!metricType) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'metricType obrigatório.' } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await deactivateGoal(supabase, { tenantId: session.tenantId, patientId: params.id, metricType })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
