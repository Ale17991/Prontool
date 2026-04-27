import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * PATCH /api/anamnesis-templates/{id} — alterna active (admin only).
 * Append-only: não dá pra editar título/campos via PATCH; só o flag.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  active: z.boolean(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/anamnesis-templates/${params.id}`
  try {
    const session = await requireRole(['admin'], {
      entity: 'anamnesis_templates',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Esperado { active: boolean }' },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await supabase
      .from('anamnesis_templates')
      .update({ active: parsed.data.active })
      .eq('tenant_id', session.tenantId)
      .eq('id', params.id)
      .select('id')
      .maybeSingle()
    if (result.error) {
      throw new Error(`anamnesis template patch: ${result.error.message}`)
    }
    if (!result.data) throw new NotFoundError('anamnesis_template', params.id)
    return NextResponse.json({ ok: true, active: parsed.data.active }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
