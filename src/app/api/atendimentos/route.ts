import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T086 — GET /api/atendimentos.
 *
 * Reads from the `appointments_effective` view, applying optional query
 * filters (date range, doctor, plan, status). Tenant scoping is explicit
 * via the authenticated session — we use the service-role client for the
 * read and filter by tenant_id on the server so RLS semantics are
 * preserved even when the handler itself runs service-role (the handler
 * itself decides what tenant the caller may read from).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  doctor_id: z.string().uuid().optional(),
  plan_id: z.string().uuid().optional(),
  status: z.enum(['ativo', 'estornado', 'todos']).optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'appointments',
        route: '/api/atendimentos',
        request: req,
      },
    )

    const url = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filter parameters are malformed' } },
        { status: 400 },
      )
    }
    const filters = parsed.data

    const supabase = createSupabaseServiceClient()
    let query = supabase
      .from('appointments_effective')
      .select('*')
      .eq('tenant_id', session.tenantId)
      .order('appointment_at', { ascending: false })

    if (filters.from) query = query.gte('appointment_at', filters.from)
    if (filters.to) query = query.lte('appointment_at', filters.to)
    if (filters.doctor_id) query = query.eq('doctor_id', filters.doctor_id)
    if (filters.plan_id) query = query.eq('plan_id', filters.plan_id)
    if (filters.status && filters.status !== 'todos') {
      query = query.eq('effective_status', filters.status)
    }

    const { data, error } = await query
    if (error) throw new Error(`atendimentos query failed: ${error.message}`)
    return NextResponse.json(data ?? [], { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/atendimentos' })
  }
}
