import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getMonthlyPayoutSnapshot } from '@/lib/core/monthly-payouts'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const paramsSchema = z.object({
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
})

export async function GET(
  req: Request,
  context: { params: { mes: string } },
): Promise<Response> {
  const route = `/api/financeiro/repasse-medico/${context.params.mes}`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'profissional_saude'],
      { entity: 'monthly_payouts', route, request: req },
    )
    const parsed = paramsSchema.safeParse({ mes: context.params.mes })
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_MONTH', message: 'Mês inválido' } },
        { status: 400 },
      )
    }

    let restrictDoctorId: string | null = null
    if (session.role === 'profissional_saude') {
      const sb = createSupabaseServiceClient()
      const doctorRes = await sb
        .from('doctors')
        .select('id')
        .eq('tenant_id', session.tenantId)
        .eq('user_id', session.userId)
        .maybeSingle()
      if (doctorRes.error || !doctorRes.data) {
        return NextResponse.json({ payouts: [] }, { status: 200 })
      }
      restrictDoctorId = (doctorRes.data as { id: string }).id
    }

    const supabase = createSupabaseServiceClient()
    const snapshot = await getMonthlyPayoutSnapshot(supabase, {
      tenantId: session.tenantId,
      month: parsed.data.mes,
      restrictDoctorId,
    })
    return NextResponse.json(snapshot, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
