import { redirect } from 'next/navigation'
import { Calendar, TrendingDown, FileWarning, FileCheck2 } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { listPayablesWithProjections } from '@/lib/core/accounts-payable'
import type { Database } from '@/lib/db/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { PayablesTable } from './payables-table'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { status?: string; from?: string; to?: string; category?: string }
}

export default async function ContasAPagarPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'financeiro') {
    redirect('/operacao/atendimentos')
  }

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const result = await listPayablesWithProjections(supabase, {
    tenantId: session.tenantId,
    from: searchParams.from ?? null,
    to: searchParams.to ?? null,
    status: (searchParams.status as never) ?? undefined,
    category: searchParams.category ?? null,
    includeProjections: true,
  })

  const pendingCount = result.rows.filter((r) => r.status !== 'paga').length
  const overdueCount = result.rows.filter((r) => r.status === 'vencida').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Contas a Pagar
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Despesas a vencer + projeções recorrentes 90 dias.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          label="Pendente total"
          value={formatCurrency(result.summary.totalPendingCents)}
          icon={TrendingDown}
          subtitle={`${pendingCount} despesa(s)`}
        />
        <KpiCard
          label="Vencidas"
          value={overdueCount.toString()}
          icon={FileWarning}
          accent={overdueCount > 0 ? 'alert' : 'neutral'}
        />
        <KpiCard
          label="Pagas (período)"
          value={formatCurrency(result.summary.totalPaidCents)}
          icon={FileCheck2}
          accent="success"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-primary" />
            Despesas no período ({result.rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PayablesTable rows={result.rows} />
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon: Icon,
  subtitle,
  accent = 'neutral',
}: {
  label: string
  value: string
  icon: typeof Calendar
  subtitle?: string
  accent?: 'neutral' | 'success' | 'alert'
}) {
  const colorClass =
    accent === 'alert'
      ? 'text-destructive'
      : accent === 'success'
        ? 'text-success-text'
        : 'text-slate-900'
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 inline-flex rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p className={`text-xl font-black tracking-tight ${colorClass}`}>{value}</p>
        {subtitle ? (
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
