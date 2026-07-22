/**
 * Feature 047 — /api/alimentos/[id] (equipe).
 *
 * PATCH: edita alimento próprio. DELETE: desativação lógica. Alimento global
 * ou de outra clínica → recusado (RLS + trigger + guarda de domínio).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { updateCustomFood, deactivateCustomFood } from '@/lib/core/nutrition/foods/custom'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  group_slug: z.string().max(40).optional().nullable(),
  reference_grams: z.number().positive().optional(),
  energy_kcal: z.number().nonnegative().optional().nullable(),
  protein_g: z.number().nonnegative().optional(),
  carb_g: z.number().nonnegative().optional(),
  fat_g: z.number().nonnegative().optional(),
  fiber_g: z.number().nonnegative().optional().nullable(),
})

async function gate(tenantId: string): Promise<boolean> {
  const ent = await getTenantEntitlements(createSupabaseServiceClient(), tenantId)
  return ent.hasModule('dieta')
}

function moduleDisabled(): Response {
  return NextResponse.json(
    { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
    { status: 404 },
  )
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/alimentos/${params.id}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'foods',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()

    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const b = parsed.data
    const supabase = createSupabaseServiceClient()
    await updateCustomFood(supabase, {
      tenantId: session.tenantId,
      foodId: params.id,
      name: b.name,
      groupSlug: b.group_slug,
      referenceGrams: b.reference_grams,
      energyKcal: b.energy_kcal ?? null,
      proteinG: b.protein_g,
      carbG: b.carb_g,
      fatG: b.fat_g,
      fiberG: b.fiber_g ?? null,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/alimentos/${params.id}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'foods',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()

    const supabase = createSupabaseServiceClient()
    await deactivateCustomFood(supabase, { tenantId: session.tenantId, foodId: params.id })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
