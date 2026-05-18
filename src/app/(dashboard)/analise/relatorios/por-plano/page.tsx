import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, FileText, ShieldCheck, Wallet } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import {
  PARTICULAR_KEY,
  summaryByPlan,
  type PlanSummaryRow,
} from '@/lib/core/reports/by-plan'
import type { Database } from '@/lib/db/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PeriodShortcuts } from '@/components/ui/period-shortcuts'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ReportsSubNav } from '../reports-sub-nav'

export const dynamic = 'force-dynamic'

interface PlanRow {
  id: string
  name: string
}

interface PageProps {
  searchParams: { from?: string; to?: string }
}

export default async function PorPlanoPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'report.read')) redirect('/operacao/atendimentos')

  const period = resolvePeriod(searchParams)
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
  const particularSummary = summaryByPlanId.get(PARTICULAR_KEY) ?? null

  // Cards: convenios primeiro (ordem alfabetica da query) + card Particular
  // sempre no fim. Esse card aparece mesmo com zero procedimentos no
  // periodo — e onde caem todas as linhas com appointment_procedures.plan_id
  // IS NULL (atendimentos sem convenio).
  const planCards = plans.map((p) => ({
    id: p.id,
    name: p.name,
    summary: summaryByPlanId.get(p.id) ?? null,
    isParticular: false as const,
  }))
  const particularCard = {
    id: PARTICULAR_KEY,
    name: 'Particular',
    summary: particularSummary,
    isParticular: true as const,
  }
  const cards = [...planCards, particularCard]
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

      <Card>
        <CardContent className="space-y-3 p-4">
          <PeriodShortcuts
            basePath="/analise/relatorios/por-plano"
            currentFrom={period.from}
            currentTo={period.to}
          />
          <form
            method="get"
            className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <div className="space-y-1.5">
              <Label htmlFor="from" className="text-xs">
                Data início
              </Label>
              <Input
                id="from"
                name="from"
                type="date"
                defaultValue={period.from}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to" className="text-xs">
                Data fim
              </Label>
              <Input id="to" name="to" type="date" defaultValue={period.to} required />
            </div>
            <Button type="submit">Atualizar</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryStat label="Planos ativos" value={plans.length.toString()} />
        <SummaryStat
          label="Procedimentos no período"
          value={grandTotalProcedures.toString()}
        />
        <SummaryStat
          label="Faturamento no período"
          value={formatCurrency(grandTotalRevenue)}
          highlight
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <PlanCard
            key={c.id}
            planId={c.id}
            name={c.name}
            count={c.summary?.procedureCount ?? 0}
            totalCents={c.summary?.totalRevenueCents ?? 0}
            variant={c.isParticular ? 'particular' : 'plan'}
          />
        ))}
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-6 text-center text-sm text-slate-500">
            Nenhum convênio ativo cadastrado — apenas atendimentos particulares
            aparecem acima.{' '}
            <Link
              href="/configuracoes/convenios"
              className="font-semibold text-primary underline"
            >
              Cadastrar plano
            </Link>
            .
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function PlanCard({
  planId,
  name,
  count,
  totalCents,
  variant,
}: {
  planId: string
  name: string
  count: number
  totalCents: number
  variant: 'plan' | 'particular'
}) {
  const Icon = variant === 'particular' ? Wallet : ShieldCheck
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-primary" />
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
              ? 'mt-2 text-2xl font-black tabular-nums text-success-strong'
              : 'mt-2 text-2xl font-black tabular-nums text-slate-900'
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function resolvePeriod(sp: PageProps['searchParams']): { from: string; to: string } {
  const fromValid = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null
  const toValid = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : null
  if (fromValid && toValid && fromValid <= toValid) return { from: fromValid, to: toValid }
  return currentMonthRange(new Date())
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
