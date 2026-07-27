/**
 * Feature 047 — /api/alimentos (equipe).
 *
 * GET: busca no catálogo (global + próprios da clínica). POST: cadastra
 * alimento próprio (admin/profissional_saude). Ambos gated pelo módulo `dieta`.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { searchFoods } from '@/lib/core/nutrition/foods/search'
import { createCustomFood } from '@/lib/core/nutrition/foods/custom'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const measureSchema = z.object({
  label: z.string().min(1).max(60),
  grams: z.number().positive(),
  is_default: z.boolean().optional(),
})

const createSchema = z.object({
  name: z.string().min(1).max(200),
  group_slug: z.string().max(40).optional().nullable(),
  reference_grams: z.number().positive(),
  energy_kcal: z.number().nonnegative().optional().nullable(),
  protein_g: z.number().nonnegative(),
  carb_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  fiber_g: z.number().nonnegative().optional().nullable(),
  micronutrients: z.record(z.string(), z.number().nonnegative()).optional().nullable(),
  measures: z.array(measureSchema).max(20).optional(),
})

async function gateModule(tenantId: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient()
  const ent = await getTenantEntitlements(supabase, tenantId)
  return ent.hasModule('dieta')
}

function moduleDisabled(): Response {
  return NextResponse.json(
    { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
    { status: 404 },
  )
}

export async function GET(req: Request): Promise<Response> {
  const route = '/api/alimentos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'foods',
      route,
      request: req,
    })
    if (!(await gateModule(session.tenantId))) return moduleDisabled()

    const url = new URL(req.url)
    const supabase = createSupabaseServiceClient()
    const foods = await searchFoods(supabase, {
      tenantId: session.tenantId,
      query: url.searchParams.get('q') ?? undefined,
      group: url.searchParams.get('group') ?? undefined,
      scope: url.searchParams.get('scope') === 'custom' ? 'custom' : 'all',
      limit: Number(url.searchParams.get('limit')) || 20,
    })
    return NextResponse.json({ foods }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/alimentos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'foods',
      route,
      request: req,
    })
    if (!(await gateModule(session.tenantId))) return moduleDisabled()

    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const b = parsed.data
    const supabase = createSupabaseServiceClient()
    const result = await createCustomFood(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      name: b.name,
      groupSlug: b.group_slug ?? null,
      referenceGrams: b.reference_grams,
      energyKcal: b.energy_kcal ?? null,
      proteinG: b.protein_g,
      carbG: b.carb_g,
      fatG: b.fat_g,
      fiberG: b.fiber_g ?? null,
      micronutrients: b.micronutrients ?? null,
      measures: b.measures?.map((m) => ({ label: m.label, grams: m.grams, isDefault: m.is_default })),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
