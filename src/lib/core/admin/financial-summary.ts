import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { Plan } from '@/lib/core/entitlements/plans'
import { getPlanPrices } from './plan-prices'

/**
 * Feature 044 (US1) — resumo financeiro / MRR. Leitura cross-tenant
 * (super-admin via service client). MRR = clínicas ATIVAS por plano × preço.
 */
const PLANS: Plan[] = ['essencial', 'pro', 'clinica', 'legacy']
const STATUSES = ['trial', 'active', 'past_due', 'canceled'] as const
type BillingStatus = (typeof STATUSES)[number]

export interface FinancialSummary {
  mrrTotalCents: number
  mrrByPlan: Record<Plan, { count: number; cents: number }>
  countByStatus: Record<BillingStatus, number>
  trialsEnding: Array<{ tenantId: string; name: string; plan: Plan; trialEndsAt: string | null }>
  pastDue: Array<{ tenantId: string; name: string; plan: Plan; priceCents: number }>
  churn: Array<{ tenantId: string; name: string; plan: Plan; at: string }>
}

interface EntRow {
  tenant_id: string
  plan: string
  status: string | null
  trial_ends_at: string | null
  updated_at: string | null
}

export async function getFinancialSummary(
  supabase: SupabaseClient<Database>,
  opts: { trialWindowDays?: number; churnFrom?: string; churnTo?: string } = {},
): Promise<FinancialSummary> {
  const trialWindowDays = opts.trialWindowDays ?? 7
  const prices = await getPlanPrices(supabase)

  const [{ data: entData }, { data: tenantData }] = await Promise.all([
    supabase
      .from('tenant_entitlements')
      .select('tenant_id, plan, status, trial_ends_at, updated_at'),
    supabase.from('tenants').select('id, name'),
  ])
  const ents = (entData ?? []) as unknown as EntRow[]
  const nameById = new Map(
    ((tenantData ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  )
  const planOf = (p: string): Plan => ((PLANS as string[]).includes(p) ? (p as Plan) : 'legacy')
  const name = (id: string) => nameById.get(id) ?? '—'

  const mrrByPlan: FinancialSummary['mrrByPlan'] = {
    essencial: { count: 0, cents: 0 },
    pro: { count: 0, cents: 0 },
    clinica: { count: 0, cents: 0 },
    legacy: { count: 0, cents: 0 },
  }
  const countByStatus: Record<BillingStatus, number> = {
    trial: 0,
    active: 0,
    past_due: 0,
    canceled: 0,
  }
  const trialsEnding: FinancialSummary['trialsEnding'] = []
  const pastDue: FinancialSummary['pastDue'] = []
  const churn: FinancialSummary['churn'] = []

  const now = new Date()
  const trialLimit = new Date(now.getTime() + trialWindowDays * 86400000)
  const churnFrom = opts.churnFrom ? new Date(opts.churnFrom) : null
  const churnTo = opts.churnTo ? new Date(opts.churnTo) : null

  for (const e of ents) {
    const plan = planOf(e.plan)
    const status = (STATUSES as readonly string[]).includes(e.status ?? '')
      ? (e.status as BillingStatus)
      : 'active'
    countByStatus[status] += 1

    if (status === 'active') {
      mrrByPlan[plan].count += 1
      mrrByPlan[plan].cents += prices[plan]
    }
    if (status === 'trial' && e.trial_ends_at) {
      const end = new Date(e.trial_ends_at)
      if (end <= trialLimit) {
        trialsEnding.push({
          tenantId: e.tenant_id,
          name: name(e.tenant_id),
          plan,
          trialEndsAt: e.trial_ends_at,
        })
      }
    }
    if (status === 'past_due') {
      pastDue.push({
        tenantId: e.tenant_id,
        name: name(e.tenant_id),
        plan,
        priceCents: prices[plan],
      })
    }
    if (status === 'canceled' && e.updated_at) {
      const at = new Date(e.updated_at)
      if ((!churnFrom || at >= churnFrom) && (!churnTo || at <= churnTo)) {
        churn.push({ tenantId: e.tenant_id, name: name(e.tenant_id), plan, at: e.updated_at })
      }
    }
  }

  const mrrTotalCents = PLANS.reduce((s, p) => s + mrrByPlan[p].cents, 0)
  trialsEnding.sort((a, b) => (a.trialEndsAt ?? '').localeCompare(b.trialEndsAt ?? ''))

  return { mrrTotalCents, mrrByPlan, countByStatus, trialsEnding, pastDue, churn }
}
