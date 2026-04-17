import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listAuditPage } from '@/lib/core/audit/export'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T170 — GET /api/auditoria. Leitura paginada via cursor (timestamp_utc
 * decrescente). Admin-only.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  entity: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  result: z.enum(['success', 'denied', 'conflict']).optional(),
  cursor: z.string().nullable().optional(),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v))),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'audit_log',
      route: '/api/auditoria',
      request: req,
    })
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const page = await listAuditPage(supabase, {
      tenantId: session.tenantId,
      entity: parsed.data.entity,
      from: parsed.data.from,
      to: parsed.data.to,
      result: parsed.data.result,
      cursor: parsed.data.cursor ?? null,
      limit: parsed.data.limit,
    })
    return NextResponse.json(
      { entries: page.entries, next_cursor: page.nextCursor },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: '/api/auditoria' })
  }
}
