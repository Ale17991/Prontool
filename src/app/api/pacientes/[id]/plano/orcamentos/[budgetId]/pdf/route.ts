import { NextResponse } from 'next/server'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { listPlan } from '@/lib/core/dental/treatment-plan/list-plan'
import { renderBudgetPdf, type BudgetPdfItem } from '@/lib/core/dental/treatment-plan/budget-pdf'
import type { Surface } from '@/lib/core/dental/teeth'
import { toHttpResponse } from '@/lib/observability/http'
import { NotFoundError } from '@/lib/observability/errors'
import {
  auditPrintout,
  deniedResponse,
  openPrintout,
  PrintoutDenied,
} from '@/lib/core/printouts/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Exporta o orçamento como PDF (FR-011/SC-007). */
export async function GET(
  req: Request,
  { params }: { params: { id: string; budgetId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/plano/orcamentos/${params.budgetId}/pdf`
  try {
    const ctx = await openPrintout({
      req,
      patientId: params.id,
      route,
      entity: 'treatment_budgets',
      entityId: params.budgetId,
      document: 'orcamento-odonto',
      roles: ['admin', 'financeiro', 'profissional_saude'],
    })
    const supabase = ctx.supabase

    const [clinicProfile, plan] = await Promise.all([
      getClinicProfile(supabase, ctx.tenantId).catch(() => null),
      listPlan(supabase, { tenantId: ctx.tenantId, patientId: params.id }),
    ])

    const budget = plan.budgets.find((b) => b.id === params.budgetId)
    if (!budget) throw new NotFoundError('treatment_budget', params.budgetId)

    const items: BudgetPdfItem[] = plan.items
      .filter((s) => s.budgetId === params.budgetId && s.status !== 'cancelado')
      .map((s) => ({
        toothFdi: s.toothFdi,
        surface: (s.surface as Surface | null) ?? null,
        title: s.title,
        priceCents: s.currentPriceCents,
      }))

    const totalCents =
      budget.frozenTotalCents ?? items.reduce((sum, it) => sum + (it.priceCents ?? 0), 0)

    const buf = await renderBudgetPdf({
      clinicProfile,
      identity: ctx.identity,
      budget: {
        title: budget.title,
        status: budget.status,
        totalCents,
        acceptedAt: budget.acceptedAt,
      },
      items,
    })

    const stamp = new Date().toISOString().slice(0, 10)
    await auditPrintout(ctx)

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="orcamento-${params.budgetId.slice(0, 8)}-${stamp}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
