'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'
import type { CashFlowBucket, CashFlowEvent } from '@/lib/core/cash-flow'

interface Props {
  buckets: CashFlowBucket[]
  events: CashFlowEvent[]
}

export function CashFlowChart({ buckets, events }: Props) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">
        <p className="text-sm text-slate-500">Sem movimentação prevista no período.</p>
      </div>
    )
  }

  const chartData = buckets.map((b) => ({
    key: b.key,
    saldo: b.balanceAfterCents / 100,
    entradas: b.entriesCents / 100,
    saidas: -(b.exitsCents / 100),
  }))

  return (
    <div className="space-y-4">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="key" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={56} />
            <Tooltip
              formatter={(value, name) => [
                formatCurrency(Math.round(Number(value) * 100)),
                String(name),
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="saldo"
              name="Saldo acumulado"
              stroke="#1C4F71"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="entradas"
              name="Entradas"
              stroke="#10b981"
              strokeWidth={1.5}
              dot={{ r: 2 }}
            />
            <Line
              type="monotone"
              dataKey="saidas"
              name="Saídas"
              stroke="#dc2626"
              strokeWidth={1.5}
              dot={{ r: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs">
        <summary className="cursor-pointer font-bold text-slate-700">
          Eventos individuais ({events.length})
        </summary>
        <div className="mt-3 max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="py-1 text-left">Data</th>
                <th className="py-1 text-left">Descrição</th>
                <th className="py-1 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 200).map((e, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1 font-mono text-[11px]">{e.date}</td>
                  <td className="py-1">
                    {e.description}
                    {e.isProjection ? (
                      <span className="ml-1 text-[9px] text-slate-400">(prev.)</span>
                    ) : null}
                  </td>
                  <td
                    className={`py-1 text-right font-bold ${
                      e.type === 'entry' ? 'text-success-text' : 'text-destructive'
                    }`}
                  >
                    {e.type === 'entry' ? '+' : '−'}
                    {formatCurrency(e.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
