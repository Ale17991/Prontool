import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { updatePlanActive } from '@/lib/core/plans/update-active'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T165 — PATCH /api/planos/{id}. Admin-only. Renomear é proibido por
 * design (preserva integridade de relatórios históricos); apenas
 * `active` pode ser alterado.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({ active: z.boolean() })

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'health_plans',
      entityId: params.id,
      route: `/api/planos/${params.id}`,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Apenas o campo `active` pode ser alterado' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const updated = await updatePlanActive(supabase, {
      tenantId: session.tenantId,
      planId: params.id,
      active: parsed.data.active,
    })
    return NextResponse.json(updated, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/planos/${params.id}` })
  }
}
