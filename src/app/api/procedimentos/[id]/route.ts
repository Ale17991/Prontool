import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { updateProcedure } from '@/lib/core/procedures/update-active'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T164 — PATCH /api/procedimentos/{id}. Admin-only.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  display_name: z.string().nullable().optional(),
  active: z.boolean().optional(),
  default_amount_cents: z.number().int().nonnegative().nullable().optional(),
  covered_by_plan: z.boolean().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'procedures',
      entityId: params.id,
      route: `/api/procedimentos/${params.id}`,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const updated = await updateProcedure(supabase, {
      tenantId: session.tenantId,
      procedureId: params.id,
      patch: {
        ...(parsed.data.display_name !== undefined ? { displayName: parsed.data.display_name } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        ...(parsed.data.default_amount_cents !== undefined
          ? { defaultAmountCents: parsed.data.default_amount_cents }
          : {}),
        ...(parsed.data.covered_by_plan !== undefined
          ? { coveredByPlan: parsed.data.covered_by_plan }
          : {}),
      },
    })
    return NextResponse.json(
      {
        id: updated.id,
        display_name: updated.displayName,
        active: updated.active,
        default_amount_cents: updated.defaultAmountCents,
        covered_by_plan: updated.coveredByPlan,
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/procedimentos/${params.id}` })
  }
}
