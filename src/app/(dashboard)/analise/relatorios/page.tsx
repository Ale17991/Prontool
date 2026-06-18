import { redirect } from 'next/navigation'
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Calculator,
  Download,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Receipt,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import {
  buildFinancialReport,
  type FinancialReport,
} from '@/lib/core/reports/financial-report'
import type { Database } from '@/lib/db/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { FinancialRevenueChart } from './financial-revenue-chart'
import { ReportsSubNav } from './reports-sub-nav'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { from?: string; to?: string }
}

const CATEGORY_LABEL: Record<string, string> = {
  aluguel: 'Aluguel',
  equipamentos: 'Equipamentos',
  materiais: 'Materiais',
  pessoal: 'Pessoal',
  servicos: 'Serviços',
  outros: 'Outros',
}

export default async function RelatoriosPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'report.read')) redirect('/operacao/atendimentos')

  const period = resolvePeriod(searchParams)
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const report = await buildFinancialReport(supabase, {
    tenantId: session.tenantId,
    from: period.from,
    to: period.to,
  })

  const canExport = can(session.role, 'report.export')
  const exportQs = `from=${period.from}&to=${period.to}`

  const isEmpty =
    report.totals.appointmentCount === 0 && report.totals.totalExpensesCents === 0

  return (
    <div className="space-y-8">
      <PeriodHeader period={period} canExport={canExport} exportQs={exportQs} />

      <ReportsSubNav active="dashboard" />

      {isEmpty ? (
        <Card>
          <CardContent className="px-6 py-10 text-center text-sm text-slate-600">
            <p className="font-bold text-slate-900">
              Nenhum atendimento ou despesa neste período.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Período {formatDate(period.from)} até {formatDate(period.to)}. Tente um
              intervalo mais amplo (12 meses ou YTD) usando os botões acima.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <OperationalResultSection report={report} />

      <RevenueSection report={report} />

      <TaxSection report={report} />

      <ExpensesSection report={report} />

      <ProductivityComparisonSection report={report} />
    </div>
  )
}

function PeriodHeader({
  period,
  canExport,
  exportQs,
}: {
  period: { from: string; to: string }
  canExport: boolean
  exportQs: string
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Relatório financeiro
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Exibindo dados de <span className="font-semibold">{formatDate(period.from)}</span> a{' '}
          <span className="font-semibold">{formatDate(period.to)}</span>
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <form
              method="get"
              className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
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
              <QuickRangeButtons period={period} />
            </form>
            {canExport ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/relatorios/financeiro/export/excel?${exportQs}`}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Excel
                </a>
                <a
                  href={`/api/relatorios/financeiro/export/pdf?${exportQs}`}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  PDF
                </a>
                <a
                  href={`/api/relatorios/financeiro/export/pdf?${exportQs}`}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Exportar geral
                </a>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function QuickRangeButtons({ period }: { period: { from: string; to: string } }) {
  const now = new Date()
  const today = toYmd(now)
  const thisWeek = weekRange(now)
  const thisMonth = monthRange(now)
  const lastMonth = monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const ytd = ytdRange(now)
  const last12 = lastNMonthsRange(now, 12)

  const presets: Array<{ label: string; range: { from: string; to: string } }> = [
    { label: 'Hoje', range: { from: today, to: today } },
    { label: 'Esta semana', range: thisWeek },
    { label: 'Este mês', range: thisMonth },
    { label: 'Mês anterior', range: lastMonth },
    { label: 'Ano (YTD)', range: ytd },
    { label: '12 meses', range: last12 },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((p) => {
        const active = period.from === p.range.from && period.to === p.range.to
        return (
          <a
            key={p.label}
            href={`/analise/relatorios?from=${p.range.from}&to=${p.range.to}`}
            className={cn(
              'rounded-md border px-3 py-2 text-xs font-bold transition-colors',
              active
                ? 'border-primary bg-primary text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {p.label}
          </a>
        )
      })}
    </div>
  )
}

function lastNMonthsRange(ref: Date, months: number): { from: string; to: string } {
  const to = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
  const from = new Date(ref.getFullYear(), ref.getMonth() - months + 1, 1)
  return { from: toYmd(from), to: toYmd(to) }
}

function ytdRange(ref: Date): { from: string; to: string } {
  const from = new Date(ref.getFullYear(), 0, 1)
  return { from: toYmd(from), to: toYmd(ref) }
}

function RevenueSection({ report }: { report: FinancialReport }) {
  const totalGross = report.totals.grossRevenueCents
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Análise de Receita"
        subtitle="Desempenho por canal, profissional e serviço"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Receita por plano de saúde
              </p>
              <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                {formatCurrency(totalGross)}
              </p>
            </div>
            <div className="rounded-xl bg-info-bg p-2.5 text-info-text">
              <LayoutDashboard className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {report.revenueByPlan.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-slate-500">Sem dados no período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Convênio</TableHead>
                    <TableHead className="text-right">Atendimentos</TableHead>
                    <TableHead className="text-right">Bruto</TableHead>
                    <TableHead className="text-right">Imposto convênio</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead className="text-right">Market share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.revenueByPlan.map((row) => (
                    <TableRow key={row.planId}>
                      <TableCell className="font-semibold text-slate-900">
                        {row.planName}
                      </TableCell>
                      <TableCell className="text-right text-slate-700">
                        {row.appointmentCount}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900">
                        {formatCurrency(row.grossRevenueCents)}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.taxRateBps > 0 ? (
                          <span className="text-destructive tabular-nums">
                            −{formatCurrency(row.taxFromPlanCents)}
                            <span className="ml-1 text-[10px] text-slate-400">
                              ({(row.taxRateBps / 100).toFixed(2).replace('.', ',')}%)
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">R$ 0,00</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900 tabular-nums">
                        {formatCurrency(row.netOfPlanTaxCents)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.min(row.marketSharePct, 100)}%` }}
                            />
                          </div>
                          <span className="w-12 text-xs text-slate-600">
                            {row.marketSharePct.toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-primary" />
                Top profissionais
              </CardTitle>
              <p className="text-[11px] text-slate-500">
                5 profissionais com mais faturamento
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {report.topDoctors.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-slate-500">Sem dados no período.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {report.topDoctors.map((row, i) => (
                    <li
                      key={row.doctorId}
                      className="flex items-center gap-3 px-6 py-3"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-700">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-900">
                          {row.doctorName}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {row.appointmentCount} atendimento
                          {row.appointmentCount === 1 ? '' : 's'}
                        </p>
                        {row.byPlan.length > 0 ? (
                          <p className="mt-0.5 truncate text-[10px] text-slate-400">
                            {row.byPlan
                              .slice(0, 3)
                              .map(
                                (p) =>
                                  `${p.planName}: ${formatCurrency(p.grossRevenueCents)}`,
                              )
                              .join(' · ')}
                            {row.byPlan.length > 3 ? ' · …' : ''}
                          </p>
                        ) : null}
                      </div>
                      <span className="text-right text-xs font-bold tabular-nums text-slate-900">
                        {formatCurrency(row.grossRevenueCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-[#2D4E4D] bg-[#1A3741] text-white shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Stethoscope className="h-4 w-4 text-blue-300" />
                Ranking procedimentos
              </CardTitle>
              <p className="text-[11px] text-slate-300">
                10 procedimentos mais realizados
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {report.topProcedures.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-slate-300">Sem dados no período.</p>
              ) : (
                <ol className="divide-y divide-white/10">
                  {report.topProcedures.map((row, i) => (
                    <li
                      key={row.procedureId}
                      className="flex items-center gap-3 px-6 py-2.5"
                    >
                      <span className="w-5 text-[11px] font-black text-slate-400">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-white">
                          {row.procedureName}
                        </p>
                        <p className="font-mono text-[10px] text-slate-400">
                          {row.tussCode || '—'} · {row.count}x
                        </p>
                      </div>
                      <span className="text-right text-[11px] font-bold tabular-nums text-emerald-300">
                        {formatCurrency(row.totalCents)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}

function TaxSection({ report }: { report: FinancialReport }) {
  const { fromPlansCents, fromExpensesCents, totalCents } = report.taxTotals
  if (totalCents === 0) return null
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Impostos"
        subtitle="Imposto retido pelos convênios + impostos pagos pela clínica no período"
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <div className="mb-3 inline-flex rounded-xl border border-[#EDE9FE] bg-[#FAF5FF] p-2.5 text-[#6B21A8]">
              <Calculator className="h-4 w-4" />
            </div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Total no período
            </p>
            <p className="text-2xl font-black tracking-tight text-slate-900">
              {formatCurrency(totalCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="mb-3 inline-flex rounded-xl border border-info/30 bg-info-bg p-2.5 text-info-text">
              <Building2 className="h-4 w-4" />
            </div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Retido pelos convênios
            </p>
            <p className="text-xl font-black tracking-tight text-slate-900">
              {formatCurrency(fromPlansCents)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Somatório de bruto × alíquota de cada convênio.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="mb-3 inline-flex rounded-xl border border-destructive/30 bg-destructive/10 p-2.5 text-destructive">
              <Receipt className="h-4 w-4" />
            </div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Pagos pela clínica
            </p>
            <p className="text-xl font-black tracking-tight text-slate-900">
              {formatCurrency(fromExpensesCents)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Despesas categorizadas como Impostos no período.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function ExpensesSection({ report }: { report: FinancialReport }) {
  const expensesPct = report.comparison.expensesPct
  const expensesGood = expensesPct !== null && expensesPct < 0
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Fluxo de Despesas"
        subtitle="Detalhamento dos custos operacionais"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Custos totais
                </p>
                <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">
                  {formatCurrency(report.totals.totalExpensesCents)}
                </p>
              </div>
              <div className="rounded-xl bg-destructive/10 p-2.5 text-destructive">
                <TrendingDown className="h-4 w-4" />
              </div>
            </div>
            {expensesPct !== null ? (
              <div
                className={cn(
                  'mt-4 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold',
                  expensesGood
                    ? 'bg-success-bg text-success-text'
                    : 'bg-destructive/10 text-destructive',
                )}
              >
                {expensesPct >= 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {expensesPct >= 0 ? '+' : ''}
                {expensesPct.toFixed(1)}% vs anterior
              </div>
            ) : (
              <p className="mt-4 text-[11px] text-slate-500">
                Sem comparativo (período anterior zerado).
              </p>
            )}
            <p className="mt-3 text-[11px] text-slate-500">
              Período anterior: {formatCurrency(report.previous.totalExpensesCents)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Receipt className="h-4 w-4 text-primary" />
              Despesas por categoria
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {report.expensesByCategory.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-slate-500">
                Nenhuma despesa lançada no período.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">% do total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.expensesByCategory.map((row) => (
                    <TableRow key={row.category}>
                      <TableCell className="font-semibold text-slate-900">
                        {CATEGORY_LABEL[row.category] ?? row.category}
                      </TableCell>
                      <TableCell className="text-right text-slate-700">
                        {row.count}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900">
                        {formatCurrency(row.totalCents)}
                      </TableCell>
                      <TableCell className="text-right text-slate-700">
                        {row.pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function OperationalResultSection({ report }: { report: FinancialReport }) {
  const profitNeg = report.totals.operatingProfitCents < 0
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Resultado Operacional"
        subtitle="Rentabilidade e eficiência do período"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ResultMiniCard
          label="Faturamento bruto"
          value={formatCurrency(report.totals.grossRevenueCents)}
          tone="positive"
        />
        <ResultMiniCard
          label="Comissões pagas"
          value={`-${formatCurrency(report.totals.commissionsCents)}`}
          tone="negative"
        />
        <ResultMiniCard
          label="Receita líquida"
          value={formatCurrency(report.totals.netRevenueCents)}
          tone="positive"
        />
        <ResultMiniCard
          label="Total despesas"
          value={`-${formatCurrency(report.totals.totalExpensesCents)}`}
          tone="negative"
        />
      </div>

      <Card className="border-[#2D4E4D] bg-[#1A3741] text-white shadow-md">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Lucro operacional
              </p>
              <p
                className={cn(
                  'mt-2 text-4xl font-black tracking-tight',
                  profitNeg ? 'text-destructive' : 'text-white',
                )}
              >
                {formatCurrency(report.totals.operatingProfitCents)}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Receita líquida menos despesas operacionais
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Margem op.
              </p>
              <p
                className={cn(
                  'mt-2 text-3xl font-black tracking-tight',
                  profitNeg ? 'text-destructive' : 'text-success',
                )}
              >
                {report.totals.operatingMarginPct.toFixed(1)}%
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Lucro / faturamento bruto
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function ResultMiniCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'positive' | 'negative'
}) {
  const Icon = tone === 'positive' ? ArrowUpRight : ArrowDownRight
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {label}
          </p>
          <div
            className={cn(
              'rounded-lg p-1.5',
              tone === 'positive' ? 'bg-success-bg text-success-strong' : 'bg-destructive/10 text-destructive',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <p className="mt-3 text-xl font-black tracking-tight tabular-nums text-slate-900">
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function ProductivityComparisonSection({ report }: { report: FinancialReport }) {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Comparativo de Produtividade"
        subtitle={`Comparação direta com o período de ${formatDate(
          report.previousPeriod.from,
        )} a ${formatDate(report.previousPeriod.to)}`}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-primary" />
            Evolução da receita no período
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FinancialRevenueChart
            data={report.dailyRevenue.map((p) => ({
              date: p.date,
              grossRevenueCents: p.grossRevenueCents,
            }))}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ComparisonBadge
          label="Receita"
          pct={report.comparison.revenuePct}
          positiveIsGood
          icon={<TrendingUp className="h-3.5 w-3.5" />}
        />
        <ComparisonBadge
          label="Despesas"
          pct={report.comparison.expensesPct}
          positiveIsGood={false}
          icon={<TrendingDown className="h-3.5 w-3.5" />}
        />
        <ComparisonBadge
          label="Lucro"
          pct={report.comparison.profitPct}
          positiveIsGood
          icon={<Calculator className="h-3.5 w-3.5" />}
        />
      </div>
    </section>
  )
}

function ComparisonBadge({
  label,
  pct,
  positiveIsGood,
  icon,
}: {
  label: string
  pct: number | null
  positiveIsGood: boolean
  icon: React.ReactNode
}) {
  if (pct === null) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {label}
            </p>
            <p className="mt-2 text-lg font-black text-slate-400">—</p>
            <p className="text-[10px] text-slate-500">Sem dados no período anterior.</p>
          </div>
          <div className="rounded-lg bg-slate-100 p-2 text-slate-500">{icon}</div>
        </CardContent>
      </Card>
    )
  }

  const positive = pct >= 0
  const isGood = positive === positiveIsGood
  const Arrow = positive ? ArrowUpRight : ArrowDownRight

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {label}
          </p>
          <p
            className={cn(
              'mt-2 inline-flex items-center gap-1 text-2xl font-black tracking-tight',
              isGood ? 'text-success-strong' : 'text-destructive',
            )}
          >
            <Arrow className="h-5 w-5" />
            {pct >= 0 ? '+' : ''}
            {pct.toFixed(1)}%
          </p>
          <p className="text-[10px] text-slate-500">vs período anterior</p>
        </div>
        <div
          className={cn(
            'rounded-lg p-2',
            isGood ? 'bg-success-bg text-success-strong' : 'bg-destructive/10 text-destructive',
          )}
        >
          {icon}
        </div>
      </CardContent>
    </Card>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-black tracking-tight text-slate-900">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
    </div>
  )
}

function resolvePeriod(sp: PageProps['searchParams']): { from: string; to: string } {
  const fromValid = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null
  const toValid = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : null
  if (fromValid && toValid && fromValid <= toValid) return { from: fromValid, to: toValid }
  return monthRange(new Date())
}

function weekRange(ref: Date): { from: string; to: string } {
  // Semana começa no domingo — mesma convenção do calendário (calendar-filters.ts).
  const day = ref.getDay()
  const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - day)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  return { from: toYmd(start), to: toYmd(end) }
}

function monthRange(ref: Date): { from: string; to: string } {
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
