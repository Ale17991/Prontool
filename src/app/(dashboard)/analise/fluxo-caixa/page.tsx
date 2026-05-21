import { redirect } from 'next/navigation'
import { TrendingUp } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { format, addDays } from 'date-fns'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { assembleCashFlow } from '@/lib/core/cash-flow'
import type { Database } from '@/lib/db/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { CashFlowChart } from './cash-flow-chart'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { from?: string; to?: string; scale?: string }
}

export default async function FluxoCaixaPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'financeiro') {
    redirect('/operacao/atendimentos')
  }

  const today = new Date()
  const defaultFrom = format(addDays(today, -7), 'yyyy-MM-dd')
  const defaultTo = format(addDays(today, 60), 'yyyy-MM-dd')
  const from = searchParams.from ?? defaultFrom
  const to = searchParams.to ?? defaultTo
  const scale = (searchParams.scale as 'daily' | 'weekly' | 'monthly') ?? 'daily'

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const result = await assembleCashFlow(supabase, {
    tenantId: session.tenantId,
    from,
    to,
    scale,
  })

  const finalBalance = result.buckets.length
    ? result.buckets[result.buckets.length - 1]!.balanceAfterCents
    : result.startingBalanceCents
  const hasNegative = result.buckets.some((b) => b.balanceAfterCents < 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Fluxo de Caixa
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Entradas e saídas previstas + realizadas, com saldo acumulado.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="Saldo inicial" value={formatCurrency(result.startingBalanceCents)} />
        <KpiCard
          label="Saldo final projetado"
          value={formatCurrency(finalBalance)}
          accent={finalBalance < 0 ? 'alert' : 'neutral'}
        />
        <KpiCard
          label="Status"
          value={hasNegative ? 'Atenção: saldo negativo' : 'Saudável'}
          accent={hasNegative ? 'alert' : 'success'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-primary" />
            Evolução do saldo ({result.events.length} eventos)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CashFlowChart buckets={result.buckets} events={result.events} />
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({
  label,
  value,
  accent = 'neutral',
}: {
  label: string
  value: string
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
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p className={`text-xl font-black tracking-tight ${colorClass}`}>{value}</p>
      </CardContent>
    </Card>
  )
}
