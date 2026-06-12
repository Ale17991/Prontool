import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  createWorkoutPlan,
  getActiveWorkoutPlan,
  listWorkoutPlanSummaries,
} from '@/lib/core/patient-portal/workout'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 032 — plano de treino do paciente (seção "Treino" do portal).
 *  GET  → plano ativo (completo) + histórico (resumos)
 *  POST → cria um novo plano (desativa o anterior — modelo versionado)
 * RBAC: admin / profissional_saude.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/pacientes/[id]/treino'
const ROLES = ['admin', 'profissional_saude'] as const

const exerciseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sets: z.number().int().min(0).max(99).nullable(),
  reps: z.string().trim().max(40).nullable(),
  loadKg: z.number().min(0).max(1000).nullable(),
  restSeconds: z.number().int().min(0).max(3600).nullable(),
  notes: z.string().trim().max(500).nullable(),
})
const sessionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  focus: z.string().trim().max(120).nullable(),
  exercises: z.array(exerciseSchema).max(40),
})
const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(2000).nullable(),
  sessions: z.array(sessionSchema).min(1).max(20),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(ROLES, { entity: 'patient_workout_plan', route: ROUTE, request: req })
    const supabase = createSupabaseServiceClient()
    const [active, history] = await Promise.all([
      getActiveWorkoutPlan(supabase, session.tenantId, params.id),
      listWorkoutPlanSummaries(supabase, session.tenantId, params.id),
    ])
    return NextResponse.json({ active, history }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(ROLES, { entity: 'patient_workout_plan', route: ROUTE, request: req })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Dados do treino inválidos.' } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const created = await createWorkoutPlan(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      title: parsed.data.title,
      notes: parsed.data.notes,
      sessions: parsed.data.sessions,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
