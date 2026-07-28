/**
 * Feature 049 US3 — /api/pacientes/[id]/recordatorio (equipe).
 * GET: histórico + o mais recente detalhado. POST: cria/substitui o do dia.
 * Gated `nutri_recordatorio`; escrita admin/profissional_saude.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { saveRecall, listRecalls } from '@/lib/core/nutrition/recall/plan'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const itemSchema = z.object({
  food_id: z.string().uuid(),
  grams: z.number().positive().max(5000).optional().nullable(),
  measure_label: z.string().max(60).optional().nullable(),
  measure_qty: z.number().positive().optional().nullable(),
})
const mealSchema = z.object({
  name: z.string().min(1).max(80),
  position: z.number().int().min(0),
  items: z.array(itemSchema).max(50),
})
const saveSchema = z.object({
  recall_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(300).optional().nullable(),
  meals: z.array(mealSchema).max(20),
})

async function gate(tenantId: string): Promise<boolean> {
  const ent = await getTenantEntitlements(createSupabaseServiceClient(), tenantId)
  return ent.hasModule('nutri_recordatorio')
}
function moduleDisabled(): Response {
  return NextResponse.json({ error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } }, { status: 404 })
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/recordatorio`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'food_recalls',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const supabase = createSupabaseServiceClient()
    const data = await listRecalls(supabase, session.tenantId, params.id)
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/recordatorio`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'food_recalls',
      entityId: params.id,
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
    const result = await saveRecall(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      recallDate: b.recall_date,
      notes: b.notes ?? null,
      meals: b.meals.map((m) => ({
        name: m.name,
        position: m.position,
        items: m.items.map((i) => ({
          foodId: i.food_id,
          grams: i.grams ?? null,
          measureLabel: i.measure_label ?? null,
          measureQty: i.measure_qty ?? null,
        })),
      })),
    })
    const data = await listRecalls(supabase, session.tenantId, params.id)
    return NextResponse.json({ id: result.id, ...data }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
