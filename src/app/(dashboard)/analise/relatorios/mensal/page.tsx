import { redirect } from 'next/navigation'
import { Calculator, DollarSign, Download, FileText, LayoutDashboard, Receipt, Stethoscope, TrendingDown } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { buildMonthlyReport } from '@/lib/core/reports/monthly'
import type { Database } from '@/lib/db/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: {
    from?: string
    to?: string
  }
}

export default async function RelatorioMensalPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'report.read')) redirect('/operacao/atendimentos')

  const period = resolvePeriod(searchParams)
  // RLS policies em appointments/appointment_reversals/health_plans/doctors
  // filtram por jwt_tenant_id() — buildMonthlyReport ainda recebe tenantId
  // pra manter a interface e rodar os explicit .eq que complementam a RLS.
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const report = await buildMonthlyReport(supabase, {
    tenantId: session.tenantId,
    from: period.from,
    to: period.to,
  })

  const canExport = can(session.role, 'report.export')
  const exportQs = `from=${period.from}&to=${period.to}`
  const avgTicket =
    report.totals.appointmentCount > 0
      ? Math.round(report.totals.netRevenueCents / report.totals.appointmentCount)
      : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            Relatório mensal
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Receita por plano, produção por médico e comissão líquida para o período. Os
            totais já consideram estornos (appointments_effective).
          </p>
        </div>
        {canExport ? (
          <div className="flex gap-2">
            <a
              href={`/api/relatorios/mensal/export/pdf?${exportQs}`}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <Download className="h-3 w-3" />
              PDF
            </a>
            <a
              href={`/api/relatorios/mensal/export/excel?${exportQs}`}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <Download className="h-3 w-3" />
              Excel
            </a>
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Período
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="get"
            className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end"
          >
            <div className="space-y-1.5">
              <Label htmlFor="from" className="text-xs">
                De
              </Label>
              <Input id="from" name="from" type="date" defaultValue={period.from} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to" className="text-xs">
                Até
              </Label>
              <Input id="to" name="to" type="date" defaultValue={period.to} required />
            </div>
            <Button type="submit">Atualizar</Button>
            <QuickJumpButtons period={period} />
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <SummaryCard
          icon={DollarSign}
          label="Receita líquida"
          value={formatCurrency(report.totals.netRevenueCents)}
        />
        <SummaryCard
          icon={Calculator}
          label="Comissão líquida"
          value={formatCurrency(report.totals.netCommissionCents)}
        />
        <SummaryCard
          icon={Stethoscope}
          label="Atendimentos"
          value={report.totals.appointmentCount.toString()}
          sub={`Ticket médio ${formatCurrency(avgTicket)}`}
        />
        <SummaryCard
          icon={TrendingDown}
          label="Estornos"
          value={report.totals.reversalCount.toString()}
          accent={report.totals.reversalCount > 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-primary" />
            Receita por plano
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {report.revenueByPlan.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">
              Nenhum atendimento registrado no período.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plano</TableHead>
                  <TableHead className="text-right">Receita líquida</TableHead>
                  <TableHead className="text-right">Atendimentos</TableHead>
                  <TableHead className="text-right">% da receita</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.revenueByPlan.map((row) => {
                  const pct =
                    report.totals.netRevenueCents > 0
                      ? Math.round(
                          (row.netRevenueCents / report.totals.netRevenueCents) * 1000,
                        ) / 10
                      : 0
                  return (
                    <TableRow key={row.planId}>
                      <TableCell className="font-semibold text-slate-900">
                        {row.planName}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900">
                        {formatCurrency(row.netRevenueCents)}
                      </TableCell>
                      <TableCell className="text-right text-slate-700">
                        {row.appointmentCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="w-10 text-xs text-slate-600">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Receipt className="h-4 w-4 text-primary" />
            Produção por médico
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {report.productionByDoctor.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">
              Nenhuma produção registrada no período.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Médico</TableHead>
                  <TableHead className="text-right">Produção líquida</TableHead>
                  <TableHead className="text-right">Comissão líquida</TableHead>
                  <TableHead className="text-right">Atendimentos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.productionByDoctor.map((row) => (
                  <TableRow key={row.doctorId}>
                    <TableCell className="font-semibold text-slate-900">
                      {row.doctorName}
                    </TableCell>
                    <TableCell className="text-right font-bold text-slate-900">
                      {formatCurrency(row.netProductionCents)}
                    </TableCell>
                    <TableCell className="text-right text-slate-700">
                      {formatCurrency(row.netCommissionCents)}
                    </TableCell>
                    <TableCell className="text-right text-slate-700">
                      {row.appointmentCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function QuickJumpButtons({ period }: { period: { from: string; to: string } }) {
  const now = new Date()
  const thisMonth = monthRange(now)
  const lastMonth = monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1))

  return (
    <div className="flex gap-2">
      <a
        href={`/analise/relatorios/mensal?from=${thisMonth.from}&to=${thisMonth.to}`}
        className={
          period.from === thisMonth.from && period.to === thisMonth.to
            ? 'rounded-md bg-primary px-3 py-2 text-xs font-bold text-white'
            : 'rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50'
        }
      >
        Este mês
      </a>
      <a
        href={`/analise/relatorios/mensal?from=${lastMonth.from}&to=${lastMonth.to}`}
        className={
          period.from === lastMonth.from && period.to === lastMonth.to
            ? 'rounded-md bg-primary px-3 py-2 text-xs font-bold text-white'
            : 'rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50'
        }
      >
        Mês anterior
      </a>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof DollarSign
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 inline-flex rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p
          className={
            accent
              ? 'text-xl font-black tracking-tight text-rose-600'
              : 'text-xl font-black tracking-tight text-slate-900'
          }
        >
          {value}
        </p>
        {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}

function resolvePeriod(sp: PageProps['searchParams']): { from: string; to: string } {
  const fromValid = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null
  const toValid = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : null
  if (fromValid && toValid && fromValid <= toValid) return { from: fromValid, to: toValid }
  return monthRange(new Date())
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
