/**
 * Feature 046 — /api/pacientes/[id]/avaliacao-nutricional (equipe).
 *
 * POST: cria uma avaliação (composição e/ou gasto energético) — admin/
 * profissional_saude. GET: lista o histórico do paciente. Ambos gated pelo
 * módulo `nutri_avaliacao`. Append-only: sem PATCH/DELETE (correção = nova).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { createNutritionAssessment } from '@/lib/core/nutrition/assessments/create'
import { listNutritionAssessments } from '@/lib/core/nutrition/assessments/list'
import type { CircumferenceSite, DobraProtocol, SkinfoldSite, TmbEquation } from '@/lib/core/nutrition/protocols'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const macrosSchema = z
  .object({
    protPct: z.number(),
    carbPct: z.number(),
    lipPct: z.number(),
    protGkg: z.number(),
    carbGkg: z.number(),
    lipGkg: z.number(),
  })
  .partial()

const createSchema = z.object({
  assessed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD'),
  sex: z.enum(['M', 'F']),
  age_years: z.number().int().min(0).max(120),
  weight_kg: z.number().positive(),
  height_cm: z.number().positive().optional().nullable(),
  dobra_protocol: z.string().optional().nullable(),
  skinfolds: z.record(z.number()).optional().nullable(),
  circumferences: z.record(z.number()).optional().nullable(),
  fat_pct_input: z.number().optional().nullable(),
  tmb_equation: z.string().optional().nullable(),
  activity_factor: z.number().optional().nullable(),
  injury_factor: z.number().optional().nullable(),
  extra_kcal: z.number().optional().nullable(),
  eer_pa: z.number().optional().nullable(),
  eer_category: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().nullable(),
  pregnancy_weeks: z.number().optional().nullable(),
  objective: z.enum(['deficit', 'manutencao', 'superavit']).optional().nullable(),
  objective_delta_kcal: z.number().optional().nullable(),
  macros: macrosSchema.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

async function gateModule(tenantId: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient()
  const ent = await getTenantEntitlements(supabase, tenantId)
  return ent.hasModule('nutri_avaliacao')
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/avaliacao-nutricional`
  try {
    const session = await requireRole(['admin', 'financeiro', 'recepcionista', 'profissional_saude'], {
      entity: 'nutrition_assessments',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gateModule(session.tenantId))) {
      return NextResponse.json({ error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } }, { status: 404 })
    }
    const supabase = createSupabaseServiceClient()
    const assessments = await listNutritionAssessments(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json({ assessments }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/avaliacao-nutricional`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'nutrition_assessments',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gateModule(session.tenantId))) {
      return NextResponse.json({ error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } }, { status: 404 })
    }
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const b = parsed.data
    const supabase = createSupabaseServiceClient()
    const result = await createNutritionAssessment(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      assessedAt: b.assessed_at,
      sex: b.sex,
      ageYears: b.age_years,
      weightKg: b.weight_kg,
      heightCm: b.height_cm ?? null,
      dobraProtocol: (b.dobra_protocol as DobraProtocol | null) ?? null,
      skinfolds: (b.skinfolds as Partial<Record<SkinfoldSite, number>> | null) ?? null,
      circumferences: (b.circumferences as Partial<Record<CircumferenceSite, number>> | null) ?? null,
      fatPctInput: b.fat_pct_input ?? null,
      tmbEquation: (b.tmb_equation as TmbEquation | null) ?? null,
      activityFactor: b.activity_factor ?? null,
      injuryFactor: b.injury_factor ?? null,
      extraKcal: b.extra_kcal ?? null,
      eerPa: b.eer_pa ?? null,
      eerCategory: b.eer_category ?? null,
      pregnancyWeeks: b.pregnancy_weeks ?? null,
      objective: b.objective ?? null,
      objectiveDeltaKcal: b.objective_delta_kcal ?? null,
      macros: b.macros ?? null,
      notes: b.notes ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
