import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listReceivables } from '@/lib/core/accounts-receivable'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z
    .enum(['pendente', 'atrasado', 'parcial', 'inadimplencia', 'all'])
    .optional(),
  plan_id: z.string().uuid().optional(),
  patient_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/financeiro/contas-a-receber'
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista'],
      { entity: 'payment_installments', route, request: req },
    )
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await listReceivables(supabase, {
      tenantId: session.tenantId,
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
      status: parsed.data.status,
      planId: parsed.data.plan_id ?? null,
      patientId: parsed.data.patient_id ?? null,
      limit: parsed.data.limit,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
