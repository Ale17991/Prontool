import type { SupabaseClient } from '@supabase/supabase-js'
import { DollarSign, TrendingDown, Clock, AlertTriangle } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getFinancialSummary, type FinancialSummary } from '@/lib/core/admin/financial-summary'
import { getPlanPrices, type PlanPrices } from '@/lib/core/admin/plan-prices'
import { PLAN_LABEL, type Plan } from '@/lib/core/entitlements/plans'
import { formatCurrency } from '@/lib/utils'
import type { Database } from '@/lib/db/types'
import { PlanPricesForm } from './plan-prices-form'

export const dynamic = 'force-dynamic'

const PLANS: Plan[] = ['essencial', 'pro', 'clinica', 'legacy']

export default async function AdminFinanceiroPage() {
  const sb = createSupabaseServiceClient() as unknown as SupabaseClient<Database>

  let summary: FinancialSummary | null = null
  let prices: PlanPrices | null = null
  try {
    ;[summary, prices] = await Promise.all([getFinancialSummary(sb, {}), getPlanPrices(sb)])
  } catch {
    summary = null
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">Financeiro</h2>
        <p className="mt-1 text-sm text-slate-500">
          Receita recorrente (MRR), status de cobrança, trials e inadimplentes. Edite os preços de
          plano abaixo.
        </p>
      </div>

      {!summary || !prices ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Indisponível no momento.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard label="MRR total" value={formatCurrency(summary.mrrTotalCents)} icon={<DollarSign className="h-4 w-4 text-success-text" />} />
            <KpiCard label="Ativas" value={String(summary.countByStatus.active)} icon={<DollarSign className="h-4 w-4" />} />
            <KpiCard label="Em trial" value={String(summary.countByStatus.trial)} icon={<Clock className="h-4 w-4 text-[hsl(var(--warning-foreground))]" />} />
            <KpiCard label="Inadimplentes" value={String(summary.countByStatus.past_due)} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} />
          </div>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-900">MRR por plano</h3>
            <div className="space-y-1">
              {PLANS.map((p) => (
                <div key={p} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">
                    {PLAN_LABEL[p]} <span className="text-xs text-slate-400">({summary!.mrrByPlan[p].count} ativas × {formatCurrency(prices![p])})</span>
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(summary!.mrrByPlan[p].cents)}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <ListCard title="Trials a vencer" icon={<Clock className="h-4 w-4" />} empty="Nenhum trial próximo.">
              {summary.trialsEnding.map((t) => (
                <li key={t.tenantId} className="flex justify-between">
                  <span>{t.name}</span>
                  <span className="text-slate-400">{t.trialEndsAt?.slice(0, 10)}</span>
                </li>
              ))}
            </ListCard>
            <ListCard title="Inadimplentes" icon={<AlertTriangle className="h-4 w-4 text-destructive" />} empty="Nenhum inadimplente.">
              {summary.pastDue.map((t) => (
                <li key={t.tenantId} className="flex justify-between">
                  <span>{t.name}</span>
                  <span className="text-slate-400">{PLAN_LABEL[t.plan]}</span>
                </li>
              ))}
            </ListCard>
            <ListCard title="Churn (cancelados)" icon={<TrendingDown className="h-4 w-4" />} empty="Nenhum cancelamento.">
              {summary.churn.map((t) => (
                <li key={t.tenantId} className="flex justify-between">
                  <span>{t.name}</span>
                  <span className="text-slate-400">{t.at.slice(0, 10)}</span>
                </li>
              ))}
            </ListCard>
          </div>

          <PlanPricesForm prices={prices} />
        </>
      )}
    </div>
  )
}

function KpiCard(props: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="rounded-lg bg-slate-50 p-2 text-slate-500">{props.icon}</div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{props.label}</p>
        <p className="text-base font-bold tabular-nums text-slate-900">{props.value}</p>
      </div>
    </div>
  )
}

function ListCard(props: { title: string; icon: React.ReactNode; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(props.children) ? props.children : [props.children]
  const hasItems = items.some((c) => c)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
        {props.icon}
        {props.title}
      </h3>
      {hasItems ? (
        <ul className="space-y-1 text-xs text-slate-600">{props.children}</ul>
      ) : (
        <p className="text-xs text-slate-400">{props.empty}</p>
      )}
    </div>
  )
}
