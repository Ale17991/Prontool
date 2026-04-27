import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, FileText, ShieldCheck } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { summaryByPlan, type PlanSummaryRow } from '@/lib/core/reports/by-plan'
import type { Database } from '@/lib/db/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ReportsSubNav } from '../reports-sub-nav'

export const dynamic = 'force-dynamic'

interface PlanRow {
  id: string
  name: string
}

export default async function PorPlanoPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'report.read')) redirect('/operacao/atendimentos')

  const period = currentMonthRange(new Date())
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  const [summaryItems, plansRes] = await Promise.all([
    summaryByPlan(supabase, {
      tenantId: session.tenantId,
      from: period.from,
      to: period.to,
    }),
    supabase
      .from('health_plans')
      .select('id, name')
      .eq('tenant_id', session.tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
  ])

  const summaryByPlanId = new Map<string, PlanSummaryRow>(
    summaryItems.map((s) => [s.planId, s]),
  )
  const plans = (plansRes.data ?? []) as PlanRow[]
  const cards = plans.map((p) => ({
    id: p.id,
    name: p.name,
    summary: summaryByPlanId.get(p.id) ?? null,
  }))
  const grandTotalProcedures = summaryItems.reduce((acc, s) => acc + s.procedureCount, 0)
  const grandTotalRevenue = summaryItems.reduce((acc, s) => acc + s.totalRevenueCents, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Relatório financeiro
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Procedimentos realizados por plano de saúde —{' '}
          <span className="font-semibold">{formatDate(period.from)}</span> a{' '}
          <span className="font-semibold">{formatDate(period.to)}</span>
        </p>
      </div>

      <ReportsSubNav active="por-plano" />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryStat label="Planos ativos" value={plans.length.toString()} />
        <SummaryStat
          label="Procedimentos no mês"
          value={grandTotalProcedures.toString()}
        />
        <SummaryStat
          label="Faturamento no mês"
          value={formatCurrency(grandTotalRevenue)}
          highlight
        />
      </div>

      {cards.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-12 text-center text-sm text-slate-500">
            Nenhum plano de saúde ativo cadastrado.{' '}
            <Link href="/cadastros/planos" className="font-semibold text-primary underline">
              Cadastrar plano
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <PlanCard
              key={c.id}
              planId={c.id}
              name={c.name}
              count={c.summary?.procedureCount ?? 0}
              totalCents={c.summary?.totalRevenueCents ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PlanCard({
  planId,
  name,
  count,
  totalCents,
}: {
  planId: string
  name: string
  count: number
  totalCents: number
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Procedimentos
            </p>
            <p className="text-xl font-black text-slate-900 tabular-nums">{count}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Faturado
            </p>
            <p className="text-xl font-black text-slate-900 tabular-nums">
              {formatCurrency(totalCents)}
            </p>
          </div>
        </div>
        <Link
          href={`/analise/relatorios/por-plano/${planId}`}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-slate-800"
        >
          <FileText className="h-3 w-3" />
          Ver detalhes
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  )
}

function SummaryStat({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p
          className={
            highlight
              ? 'mt-2 text-2xl font-black tabular-nums text-emerald-600'
              : 'mt-2 text-2xl font-black tabular-nums text-slate-900'
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function currentMonthRange(ref: Date): { from: string; to: string } {
  const year = ref.getFullYear()
  const month = ref.getMonth()
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  return { from: toYmd(first), to: toYmd(last) }
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
