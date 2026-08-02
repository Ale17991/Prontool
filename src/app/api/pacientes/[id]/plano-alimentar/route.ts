/**
 * Feature 047 US2 — /api/pacientes/[id]/plano-alimentar (equipe).
 * GET: plano vigente + meta + delta. POST/PATCH: salva o rascunho.
 * Gated por `dieta`; escrita admin/profissional_saude.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { getDietPlanForPatient, saveDietPlanDraft } from '@/lib/core/nutrition/diet/plan'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const itemSchema = z.object({
  food_id: z.string().uuid().optional().nullable(),
  grams: z.number().positive().max(5000).optional().nullable(),
  measure_label: z.string().max(60).optional().nullable(),
  measure_qty: z.number().positive().optional().nullable(),
  equivalence_list_id: z.string().uuid().optional().nullable(),
  group_options: z
    .array(z.object({ food_id: z.string().uuid(), grams: z.number().positive().max(5000) }))
    .max(50)
    .optional()
    .nullable(),
  notes: z.string().max(300).optional().nullable(),
})
const mealSchema = z.object({
  name: z.string().min(1).max(80),
  time_label: z.string().max(20).optional().nullable(),
  position: z.number().int().min(0),
  // Fatia do VET desta refeição. `null` = sem meta própria; 0 é meta de fato.
  target_pct: z.number().min(0).max(100).optional().nullable(),
  items: z.array(itemSchema).max(50),
})
const saveSchema = z.object({
  title: z.string().max(120).optional(),
  assessment_id: z.string().uuid().optional().nullable(),
  meals: z.array(mealSchema).max(20),
})

async function gate(tenantId: string): Promise<boolean> {
  const ent = await getTenantEntitlements(createSupabaseServiceClient(), tenantId)
  return ent.hasModule('dieta')
}
function moduleDisabled(): Response {
  return NextResponse.json({ error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } }, { status: 404 })
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/plano-alimentar`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'diet_plans',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const supabase = createSupabaseServiceClient()
    const plan = await getDietPlanForPatient(supabase, session.tenantId, params.id)
    return NextResponse.json({ plan }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

async function save(req: Request, patientId: string): Promise<Response> {
  const route = `/api/pacientes/${patientId}/plano-alimentar`
  const session = await requireRole(['admin', 'profissional_saude'], {
    entity: 'diet_plans',
    entityId: patientId,
    route,
    request: req,
  })
  if (!(await gate(session.tenantId))) return moduleDisabled()
  const parsed = saveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
      { status: 400 },
    )
  }
  const b = parsed.data
  const supabase = createSupabaseServiceClient()
  const result = await saveDietPlanDraft(supabase, {
    tenantId: session.tenantId,
    patientId,
    actorUserId: session.userId,
    title: b.title ?? 'Plano alimentar',
    assessmentId: b.assessment_id ?? null,
    meals: b.meals.map((m) => ({
      name: m.name,
      timeLabel: m.time_label ?? null,
      position: m.position,
      targetPct: m.target_pct ?? null,
      items: m.items.map((i) => ({
        foodId: i.food_id ?? null,
        grams: i.grams ?? null,
        measureLabel: i.measure_label ?? null,
        measureQty: i.measure_qty ?? null,
        equivalenceListId: i.equivalence_list_id ?? null,
        groupOptions: i.group_options
          ? i.group_options.map((o) => ({ foodId: o.food_id, grams: o.grams }))
          : null,
        notes: i.notes ?? null,
      })),
    })),
  })
  const plan = await getDietPlanForPatient(supabase, session.tenantId, patientId)
  return NextResponse.json({ id: result.id, plan }, { status: 200 })
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    return await save(req, params.id)
  } catch (err) {
    return toHttpResponse(err, { route: `/api/pacientes/${params.id}/plano-alimentar` })
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    return await save(req, params.id)
  } catch (err) {
    return toHttpResponse(err, { route: `/api/pacientes/${params.id}/plano-alimentar` })
  }
}
