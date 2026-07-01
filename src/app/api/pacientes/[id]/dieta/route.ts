import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  createDietPlan,
  getActiveDietPlan,
  listDietPlanSummaries,
} from '@/lib/core/patient-portal/diet'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 032 — plano alimentar do paciente (seção "Dieta" do portal).
 *  GET  → plano ativo (completo) + histórico (resumos)
 *  POST → cria um novo plano (desativa o anterior — modelo versionado)
 * RBAC: admin / profissional_saude.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/pacientes/[id]/dieta'
const ROLES = ['admin', 'profissional_saude'] as const

const itemSchema = z.object({
  food: z.string().trim().min(1).max(160),
  quantity: z.string().trim().max(80).nullable(),
  notes: z.string().trim().max(500).nullable(),
})
const mealSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timeLabel: z.string().trim().max(40).nullable(),
  notes: z.string().trim().max(500).nullable(),
  items: z.array(itemSchema).max(40),
})
const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(2000).nullable(),
  meals: z.array(mealSchema).min(1).max(20),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(ROLES, {
      entity: 'patient_diet_plan',
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const [active, history] = await Promise.all([
      getActiveDietPlan(supabase, session.tenantId, params.id),
      listDietPlanSummaries(supabase, session.tenantId, params.id),
    ])
    return NextResponse.json({ active, history }, { status: 200 })
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
      entity: 'patient_diet_plan',
      route: ROUTE,
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Dados da dieta inválidos.' } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const created = await createDietPlan(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      title: parsed.data.title,
      notes: parsed.data.notes,
      meals: parsed.data.meals,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
