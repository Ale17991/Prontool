import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { listPlanReceivables, type ReceiptStatus } from './list'

export interface PlanReceivableTotals {
  total: number
  recebido: number
  pendente: number
  glosado: number
  naoRecebido: number
}

export interface PlanReceivableByPlan extends PlanReceivableTotals {
  planId: string
  planName: string
}

export interface PlanReceivablesSummary {
  totals: PlanReceivableTotals
  byPlan: PlanReceivableByPlan[]
}

const EMPTY = (): PlanReceivableTotals => ({
  total: 0,
  recebido: 0,
  pendente: 0,
  glosado: 0,
  naoRecebido: 0,
})

function addToBucket(b: PlanReceivableTotals, status: ReceiptStatus, cents: number) {
  b.total += cents
  if (status === 'recebido') b.recebido += cents
  else if (status === 'pendente') b.pendente += cents
  else if (status === 'glosado') b.glosado += cents
  else b.naoRecebido += cents
}

/**
 * Agrega os recebíveis de convênio por plano no período (recebido × pendente ×
 * glosado × não recebido). Sem decifrar paciente — é só para o widget/dashboard.
 */
export async function summarizePlanReceivablesByPlan(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; from: string; to: string },
): Promise<PlanReceivablesSummary> {
  const rows = await listPlanReceivables(supabase, {
    tenantId: args.tenantId,
    from: args.from,
    to: args.to,
    status: 'all',
  })

  const totals = EMPTY()
  const byPlanMap = new Map<string, PlanReceivableByPlan>()
  for (const r of rows) {
    addToBucket(totals, r.status, r.amountCents)
    let p = byPlanMap.get(r.planId)
    if (!p) {
      p = { planId: r.planId, planName: r.planName, ...EMPTY() }
      byPlanMap.set(r.planId, p)
    }
    addToBucket(p, r.status, r.amountCents)
  }

  const byPlan = Array.from(byPlanMap.values()).sort(
    (a, b) => b.pendente + b.glosado + b.naoRecebido - (a.pendente + a.glosado + a.naoRecebido),
  )
  return { totals, byPlan }
}
