import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T089 — GET /api/alertas.
 *
 * Lists alerts scoped to the caller's tenant. Status filter is optional
 * (defaults to all open alerts).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  status: z.enum(['aberto', 'resolvido', 'todos']).optional(),
  type: z
    .enum(['dlq_event', 'webhook_rejected', 'tuss_deprecated', 'signature_failure', 'rbac_denied'])
    .optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'alerts',
      route: '/api/alertas',
      request: req,
    })

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filter parameters are malformed' } },
        { status: 400 },
      )
    }
    const filters = parsed.data

    const supabase = createSupabaseServiceClient()
    let query = supabase
      .from('alerts')
      .select('*')
      .eq('tenant_id', session.tenantId)
      .order('created_at', { ascending: false })

    const effectiveStatus = filters.status ?? 'aberto'
    if (effectiveStatus !== 'todos') query = query.eq('status', effectiveStatus)
    if (filters.type) query = query.eq('type', filters.type)

    const { data, error } = await query
    if (error) throw new Error(`alerts query failed: ${error.message}`)
    return NextResponse.json(data ?? [], { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/alertas' })
  }
}
