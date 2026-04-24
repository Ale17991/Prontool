import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { enqueueGhlEvent } from '@/lib/integrations/queue/qstash-client'
import { ConflictError, NotFoundError } from '@/lib/observability/errors'
import { mintTraceId } from '@/lib/observability/trace'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T092 — POST /api/alertas/dlq/{id}/reprocess. Admin-only.
 *
 * Transitions a `raw_webhook_events` row from `dlq` back to `pending`,
 * records the transition with reason `admin-reprocess`, and re-enqueues
 * the event to QStash so the worker picks it up again. If the upstream
 * config that caused the failure is still wrong, the worker will route
 * it back to DLQ — that's fine, the dispatcher dedups alerts.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'raw_webhook_events',
      entityId: params.id,
      route: `/api/alertas/dlq/${params.id}/reprocess`,
      request: req,
    })

    const supabase = createSupabaseServiceClient()
    const existing = await supabase
      .from('raw_webhook_events')
      .select('id, tenant_id, processing_status')
      .eq('id', params.id)
      .eq('tenant_id', session.tenantId)
      .maybeSingle()
    if (existing.error) throw new Error(`raw_webhook_events read failed: ${existing.error.message}`)
    if (!existing.data) throw new NotFoundError('raw_webhook_event', params.id)
    if (existing.data.processing_status !== 'dlq') {
      throw new ConflictError(
        'NOT_IN_DLQ',
        `Event is in status '${existing.data.processing_status}', only dlq rows can be reprocessed`,
        { current_status: existing.data.processing_status },
      )
    }

    await supabase
      .from('raw_webhook_events')
      .update({
        processing_status: 'pending',
        last_processed_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .throwOnError()

    await supabase
      .from('webhook_event_transitions')
      .insert({
        tenant_id: session.tenantId,
        raw_event_id: params.id,
        from_status: 'dlq',
        to_status: 'pending',
        reason: 'admin-reprocess',
        actor: session.userId,
      })
      .throwOnError()

    const traceId = mintTraceId()
    if (process.env.NODE_ENV !== 'test' && process.env.QSTASH_TOKEN) {
      await enqueueGhlEvent({
        rawEventId: params.id,
        tenantId: session.tenantId,
        traceId,
      })
    }

    return NextResponse.json(
      { reprocessed: true, raw_event_id: params.id, trace_id: traceId },
      { status: 202 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/alertas/dlq/${params.id}/reprocess` })
  }
}
