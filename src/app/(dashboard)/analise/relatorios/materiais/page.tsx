import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Package } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { getTenantTimezone, ymdStartOfDayUtc, ymdNextDayStartUtc } from '@/lib/utils/tenant-tz'
import { materialsCostDetail } from '@/lib/core/reports/materials-cost'

/**
 * Feature 045 US2 — drilldown "Gasto com materiais" do período.
 * Total + detalhamento por insumo (base appointment_at, estornados excluídos).
 */
export const dynamic = 'force-dynamic'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

export default async function MateriaisDrilldownPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string }
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'financeiro') {
    redirect('/analise/relatorios')
  }

  const from = searchParams.from
  const to = searchParams.to
  if (!from || !to || !DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
    redirect('/analise/relatorios')
  }

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const tz = await getTenantTimezone(supabase, session.tenantId)
  const { totalCents, items } = await materialsCostDetail(supabase, {
    tenantId: session.tenantId,
    fromIso: ymdStartOfDayUtc(from, tz),
    toIso: ymdNextDayStartUtc(to, tz),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <Link
          href="/analise/relatorios"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Resultado operacional
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Package className="h-6 w-6 text-teal-600" />
          Gasto com materiais
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Período de {formatDate(from)} a {formatDate(to)} · custo dos insumos consumidos nos
          atendimentos (atendimentos estornados não entram).
        </p>
      </div>

      <Card className="border-teal-100 bg-teal-50/40">
        <CardContent className="flex items-center justify-between p-6">
          <span className="text-[10px] font-bold uppercase tracking-widest text-teal-700">
            Total do período
          </span>
          <span className="text-3xl font-black tabular-nums text-teal-800">
            {formatCurrency(totalCents)}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalhamento por insumo</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Nenhum material com custo lançado neste período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-4 font-semibold">Insumo</th>
                    <th className="py-2 pr-4 text-right font-semibold">Qtd</th>
                    <th className="py-2 text-right font-semibold">Custo total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.name} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 text-slate-700">{it.name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-500">
                        {it.quantity}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums text-slate-800">
                        {formatCurrency(it.totalCostCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
