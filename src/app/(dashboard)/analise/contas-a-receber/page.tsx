import { redirect } from 'next/navigation'
import { Receipt, AlertTriangle, Clock, TrendingUp } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { listReceivables } from '@/lib/core/accounts-receivable'
import type { Database } from '@/lib/db/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { ReceivablesTable } from './receivables-table'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { status?: string; from?: string; to?: string }
}

export default async function ContasAReceberPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Painel financeiro agregado — recepção não vê valores (finance.view_values).
  if (session.role !== 'admin' && session.role !== 'financeiro') {
    redirect('/operacao/atendimentos')
  }

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const result = await listReceivables(supabase, {
    tenantId: session.tenantId,
    status: (searchParams.status as never) ?? undefined,
    from: searchParams.from ?? null,
    to: searchParams.to ?? null,
    limit: 200,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Contas a Receber
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Parcelas pendentes, atrasadas e inadimplentes — registre pagamentos sem sair da página.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          label="Pendente total"
          value={formatCurrency(result.summary.totalPendingCents)}
          icon={Receipt}
        />
        <KpiCard
          label="Atrasadas"
          value={result.summary.countOverdue.toString()}
          icon={Clock}
          accent={result.summary.countOverdue > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard
          label="Atraso crítico (>60d)"
          value={result.summary.countCritical.toString()}
          icon={AlertTriangle}
          accent={result.summary.countCritical > 0 ? 'alert' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-primary" />
            Parcelas ({result.rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ReceivablesTable
            rows={result.rows}
            canMarkBadDebt={
              session.role === 'admin' || session.role === 'financeiro'
            }
            canReversePayment={session.role === 'admin'}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon: Icon,
  accent = 'neutral',
}: {
  label: string
  value: string
  icon: typeof Receipt
  accent?: 'neutral' | 'warning' | 'alert'
}) {
  const colorClass =
    accent === 'alert'
      ? 'text-destructive'
      : accent === 'warning'
        ? 'text-[hsl(var(--warning-foreground))]'
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
      </CardContent>
    </Card>
  )
}
