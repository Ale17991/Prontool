import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T091 — GET /api/alertas/dlq.
 *
 * Reads from the `dlq_events` view, which is `raw_webhook_events` filtered
 * to `processing_status='dlq'` and annotated with the latest failure
 * reason from `webhook_event_transitions`.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'dlq_events',
      route: '/api/alertas/dlq',
      request: req,
    })

    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('dlq_events')
      .select('id, ghl_event_id, received_at, failure_reason, processing_attempt_count')
      .eq('tenant_id', session.tenantId)
      .order('received_at', { ascending: false })
    if (error) throw new Error(`dlq query failed: ${error.message}`)
    return NextResponse.json(data ?? [], { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/alertas/dlq' })
  }
}
