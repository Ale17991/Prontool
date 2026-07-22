/**
 * Feature 047 US3 — /api/alimentos/grupos/[listId].
 * PATCH: substitui uma lista de substituição própria. DELETE: remove.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { updateEquivalenceList, deleteEquivalenceList } from '@/lib/core/nutrition/foods/equivalence'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  group_slug: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  reference_kcal: z.number().nonnegative().optional().nullable(),
  items: z.array(z.object({ food_id: z.string().uuid(), grams: z.number().positive() })).max(50),
})

async function gate(tenantId: string): Promise<boolean> {
  const ent = await getTenantEntitlements(createSupabaseServiceClient(), tenantId)
  return ent.hasModule('dieta')
}
function moduleDisabled(): Response {
  return NextResponse.json({ error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } }, { status: 404 })
}

export async function PATCH(req: Request, { params }: { params: { listId: string } }): Promise<Response> {
  const route = `/api/alimentos/grupos/${params.listId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'food_equivalence_lists',
      entityId: params.listId,
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
    await updateEquivalenceList(supabase, {
      tenantId: session.tenantId,
      listId: params.listId,
      groupSlug: b.group_slug,
      name: b.name,
      referenceKcal: b.reference_kcal ?? null,
      items: b.items.map((i) => ({ foodId: i.food_id, grams: i.grams })),
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function DELETE(req: Request, { params }: { params: { listId: string } }): Promise<Response> {
  const route = `/api/alimentos/grupos/${params.listId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'food_equivalence_lists',
      entityId: params.listId,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const supabase = createSupabaseServiceClient()
    await deleteEquivalenceList(supabase, { tenantId: session.tenantId, listId: params.listId })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
