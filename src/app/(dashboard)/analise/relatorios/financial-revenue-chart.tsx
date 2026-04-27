'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface Point {
  date: string
  grossRevenueCents: number
}

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 1,
})

const BRL_FULL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatTickDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

export function FinancialRevenueChart({ data }: { data: Point[] }) {
  const series = data.map((p) => ({
    date: p.date,
    label: formatTickDate(p.date),
    revenue: p.grossRevenueCents / 100,
  }))

  if (series.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        Sem dados no período.
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1' }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(value: number) => BRL_COMPACT.format(value)}
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1' }}
            width={70}
          />
          <Tooltip
            formatter={(value) => [
              BRL_FULL.format(typeof value === 'number' ? value : Number(value ?? 0)),
              'Receita',
            ]}
            labelStyle={{ color: '#0f172a', fontWeight: 600 }}
            contentStyle={{
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="revenue"
            stroke="#2563eb"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#2563eb' }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
