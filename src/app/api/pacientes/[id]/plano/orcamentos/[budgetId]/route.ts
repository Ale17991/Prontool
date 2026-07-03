import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { setBudgetStatus } from '@/lib/core/dental/treatment-plan/set-budget-status'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const patchSchema = z.object({
  action: z.enum(['apresentar', 'aceitar', 'recusar']),
})

/** Avança o status do orçamento (apresentar/aceitar/recusar). */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; budgetId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/plano/orcamentos/${params.budgetId}`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'treatment_budgets',
      entityId: params.budgetId,
      route,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await setBudgetStatus(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      budgetId: params.budgetId,
      action: parsed.data.action,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
