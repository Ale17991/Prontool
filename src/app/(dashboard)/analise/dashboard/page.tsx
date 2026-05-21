import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Clock,
  LayoutDashboard,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { format, addDays } from 'date-fns'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { listReceivables } from '@/lib/core/accounts-receivable'
import { listPayablesWithProjections } from '@/lib/core/accounts-payable'
import { assembleCashFlow } from '@/lib/core/cash-flow'
import { getMonthlyPayoutSnapshot } from '@/lib/core/monthly-payouts'
import type { Database } from '@/lib/db/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/**
 * US5 — Dashboard executivo financeiro.
 *
 * KPIs agregados das 4 paginas operacionais (contas a receber, contas a
 * pagar, fluxo de caixa, repasse medico). Cada card e clickavel para a
 * pagina detalhada correspondente. Alertas aparecem apenas se a condicao
 * e verdadeira (FR-041 da spec — sem zeros forcados).
 */
export default async function DashboardFinanceiroPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'financeiro') {
    redirect('/operacao/atendimentos')
  }

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const today = new Date()
  const todayIso = format(today, 'yyyy-MM-dd')
  const in30 = format(addDays(today, 30), 'yyyy-MM-dd')
  const monthNow = format(today, 'yyyy-MM')

  // Buscas paralelas — agrega sem fazer cálculos novos (cada modulo
  // expoe ja a logica e os totais).
  const [receivables, payables, cashFlow, payoutThisMonth] = await Promise.all([
    listReceivables(supabase, { tenantId: session.tenantId, limit: 500 }),
    listPayablesWithProjections(supabase, {
      tenantId: session.tenantId,
      from: todayIso,
      to: in30,
      includeProjections: true,
    }),
    assembleCashFlow(supabase, {
      tenantId: session.tenantId,
      from: todayIso,
      to: in30,
      scale: 'daily',
    }),
    getMonthlyPayoutSnapshot(supabase, {
      tenantId: session.tenantId,
      month: monthNow,
    }),
  ])

  const projectedBalance =
    cashFlow.buckets.length > 0
      ? cashFlow.buckets[cashFlow.buckets.length - 1]!.balanceAfterCents
      : cashFlow.startingBalanceCents
  const balanceWillGoNegative = cashFlow.buckets.some(
    (b) => b.balanceAfterCents < 0,
  )
  const overduePayables = payables.rows.filter((r) => r.status === 'vencida')

  const alerts: Array<{ icon: typeof AlertTriangle; label: string; href: string }> = []
  if (receivables.summary.countCritical > 0) {
    alerts.push({
      icon: AlertTriangle,
      label: `${receivables.summary.countCritical} parcela(s) em atraso crítico (>60d)`,
      href: '/analise/contas-a-receber?status=atrasado',
    })
  }
  if (overduePayables.length > 0) {
    alerts.push({
      icon: AlertTriangle,
      label: `${overduePayables.length} despesa(s) vencida(s)`,
      href: '/analise/contas-a-pagar?status=vencida',
    })
  }
  if (balanceWillGoNegative) {
    alerts.push({
      icon: AlertTriangle,
      label: 'Saldo projetado fica negativo no período',
      href: '/analise/fluxo-caixa',
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          Dashboard Financeiro
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Visão consolidada do dia-a-dia: a receber, a pagar, saldo projetado e
          repasses do mês.
        </p>
      </div>

      {alerts.length > 0 ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="space-y-2 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">
              Atenção
            </p>
            <ul className="space-y-1.5">
              {alerts.map((a, i) => (
                <li key={i}>
                  <Link
                    href={a.href}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-destructive hover:underline"
                  >
                    <a.icon className="h-4 w-4" />
                    {a.label}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          href="/analise/contas-a-receber"
          icon={Receipt}
          label="A receber (total pendente)"
          value={formatCurrency(receivables.summary.totalPendingCents)}
          sub={`${receivables.summary.countOverdue} atrasada(s)`}
          accent={receivables.summary.countOverdue > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard
          href="/analise/contas-a-pagar"
          icon={TrendingDown}
          label="A pagar (próx. 30 dias)"
          value={formatCurrency(payables.summary.totalPendingCents)}
          sub={`${overduePayables.length} vencida(s)`}
          accent={overduePayables.length > 0 ? 'alert' : 'neutral'}
        />
        <KpiCard
          href="/analise/fluxo-caixa"
          icon={TrendingUp}
          label="Saldo projetado (30d)"
          value={formatCurrency(projectedBalance)}
          sub={
            balanceWillGoNegative
              ? 'Cruza zero no período'
              : `Inicial ${formatCurrency(cashFlow.startingBalanceCents)}`
          }
          accent={balanceWillGoNegative ? 'alert' : 'success'}
        />
        <KpiCard
          href={`/analise/repasse-medico/${monthNow}`}
          icon={Wallet}
          label="Repasse devido (mês atual)"
          value={formatCurrency(payoutThisMonth.totalDueCents)}
          sub={`${payoutThisMonth.payouts.length} médico(s) · ${payoutThisMonth.isClosed ? 'Fechado' : 'Aberto'}`}
          accent="neutral"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-primary" />
              Próximos vencimentos (a receber)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {receivables.rows.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-500">
                Sem parcelas pendentes.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {receivables.rows.slice(0, 5).map((r) => (
                  <li
                    key={r.installmentId}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate text-slate-600">
                      {r.patientIsAnonymized ? '[anonimizado]' : r.patientName ?? '—'}
                    </span>
                    <span className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                      {r.dueDate}
                    </span>
                    <span className="font-bold text-slate-900">
                      {formatCurrency(r.pendingAmountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-primary" />
              Próximos vencimentos (a pagar)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {payables.rows.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-500">
                Sem despesas previstas.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {payables.rows
                  .filter((r) => r.status !== 'paga')
                  .slice(0, 5)
                  .map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="truncate text-slate-600">{r.description}</span>
                      <span className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                        {r.competenceDate}
                      </span>
                      <span className="font-bold text-slate-900">
                        {formatCurrency(r.amountCents)}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function KpiCard({
  href,
  icon: Icon,
  label,
  value,
  sub,
  accent = 'neutral',
}: {
  href: string
  icon: typeof Receipt
  label: string
  value: string
  sub?: string
  accent?: 'neutral' | 'success' | 'warning' | 'alert'
}) {
  const colorClass =
    accent === 'alert'
      ? 'text-destructive'
      : accent === 'warning'
        ? 'text-[hsl(var(--warning-foreground))]'
        : accent === 'success'
          ? 'text-success-text'
          : 'text-slate-900'
  return (
    <Link href={href} className="group">
      <Card
        className={cn(
          'h-full transition-shadow hover:shadow-md group-hover:border-primary/30',
        )}
      >
        <CardContent className="p-5">
          <div className="mb-3 inline-flex rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {label}
          </p>
          <p className={cn('text-xl font-black tracking-tight', colorClass)}>
            {value}
          </p>
          {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
        </CardContent>
      </Card>
    </Link>
  )
}
