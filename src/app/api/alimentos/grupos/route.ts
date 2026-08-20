/**
 * Feature 047 — /api/alimentos/grupos (equipe).
 * GET: grupos + listas de substituição visíveis. POST: cria lista própria (US3).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import {
  listFoodGroups,
  listEquivalenceLists,
  createEquivalenceList,
} from '@/lib/core/nutrition/foods/equivalence'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const listSchema = z.object({
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
  return NextResponse.json(
    { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
    { status: 404 },
  )
}

export async function GET(req: Request): Promise<Response> {
  const route = '/api/alimentos/grupos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'food_groups',
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const supabase = createSupabaseServiceClient()
    const [groups, equivalenceLists] = await Promise.all([
      listFoodGroups(supabase),
      listEquivalenceLists(supabase, session.tenantId),
    ])
    return NextResponse.json({ groups, equivalenceLists }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/alimentos/grupos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'food_equivalence_lists',
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const parsed = listSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const b = parsed.data
    const supabase = createSupabaseServiceClient()
    const result = await createEquivalenceList(supabase, {
      tenantId: session.tenantId,
      groupSlug: b.group_slug,
      name: b.name,
      referenceKcal: b.reference_kcal ?? null,
      items: b.items.map((i) => ({ foodId: i.food_id, grams: i.grams })),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
