/**
 * Feature 047 — /api/alimentos/grupos (equipe).
 * GET: grupos alimentares + listas de substituição visíveis à clínica.
 */
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { listFoodGroups, listEquivalenceLists } from '@/lib/core/nutrition/foods/equivalence'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  const route = '/api/alimentos/grupos'
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'food_groups',
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const ent = await getTenantEntitlements(supabase, session.tenantId)
    if (!ent.hasModule('dieta')) {
      return NextResponse.json(
        { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
        { status: 404 },
      )
    }
    const [groups, equivalenceLists] = await Promise.all([
      listFoodGroups(supabase),
      listEquivalenceLists(supabase, session.tenantId),
    ])
    return NextResponse.json({ groups, equivalenceLists }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
