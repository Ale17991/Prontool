import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { rowsToCsv, streamAllAudit } from '@/lib/core/audit/export'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T170 — GET /api/auditoria/export?format=csv|json. Admin-only.
 * FR-019: cada coluna original aparece sem transformação.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  format: z.enum(['csv', 'json']),
  entity: z.string().optional(),
  actor_id: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  result: z.enum(['success', 'denied', 'conflict']).optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'audit_log',
      route: '/api/auditoria/export',
      request: req,
    })
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Parâmetros inválidos (?format=csv|json)' } },
        { status: 400 },
      )
    }
    const filter = {
      tenantId: session.tenantId,
      entity: parsed.data.entity,
      actorId: parsed.data.actor_id,
      from: parsed.data.from,
      to: parsed.data.to,
      result: parsed.data.result,
    }
    const supabase = createSupabaseServiceClient()
    const rows = await streamAllAudit(supabase, filter)

    if (parsed.data.format === 'csv') {
      const stamp = new Date().toISOString().slice(0, 10)
      return new Response(rowsToCsv(rows), {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="auditoria-${stamp}.csv"`,
        },
      })
    }
    return NextResponse.json(rows, {
      status: 200,
      headers: {
        'content-disposition': `attachment; filename="auditoria-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/auditoria/export' })
  }
}
