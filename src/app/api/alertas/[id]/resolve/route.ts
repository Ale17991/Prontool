import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T090 — POST /api/alertas/{id}/resolve. Admin-only.
 *
 * Sets `alerts.status='resolvido'`, fills `resolved_at` / `resolved_by`,
 * and appends an `alert_status_transitions` row so the audit trail is
 * preserved.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodyShape = z.object({ note: z.string().optional() })

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'alerts',
      entityId: params.id,
      route: `/api/alertas/${params.id}/resolve`,
      request: req,
    })

    const body = bodyShape.safeParse(await req.json().catch(() => ({})))
    if (!body.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'note is optional but must be a string' } },
        { status: 400 },
      )
    }

    const supabase = createSupabaseServiceClient()
    const existing = await supabase
      .from('alerts')
      .select('id, status')
      .eq('id', params.id)
      .eq('tenant_id', session.tenantId)
      .maybeSingle()
    if (existing.error) throw new Error(`alerts read failed: ${existing.error.message}`)
    if (!existing.data) throw new NotFoundError('alert', params.id)

    const updated = await supabase
      .from('alerts')
      .update({
        status: 'resolvido',
        resolved_at: new Date().toISOString(),
        resolved_by: session.userId,
      })
      .eq('id', params.id)
      .eq('tenant_id', session.tenantId)
      .select('id, status, resolved_at, resolved_by')
      .single()
    if (updated.error || !updated.data) {
      throw new Error(`alerts update failed: ${updated.error?.message}`)
    }

    await supabase
      .from('alert_status_transitions')
      .insert({
        tenant_id: session.tenantId,
        alert_id: params.id,
        from_status: existing.data.status,
        to_status: 'resolvido',
        reason: body.data.note ?? 'admin-resolved',
        actor: session.userId,
      })
      .throwOnError()

    return NextResponse.json(updated.data, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/alertas/${params.id}/resolve` })
  }
}
