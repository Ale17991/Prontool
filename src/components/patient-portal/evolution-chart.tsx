'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Feature 030 — gráficos de evolução SÓ-LEITURA do portal do paciente
 * (T023). Extraídos do padrão visual de `vital-signs-section.tsx`, sem o
 * formulário (entrada é staff). Edge case coberto: série com 1 ponto
 * mostra o valor mesmo sem linha de tendência.
 */

export interface SeriesPoint {
  /** Data ISO (date ou datetime). */
  date: string
  value: number
}

export interface WeightImcPointUI {
  measuredAt: string
  weightKg: number | null
  bmi: number | null
}

/** dd/mm sem sofrer shift de fuso em datas date-only (YYYY-MM-DD). */
export function formatDateLabel(iso: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}`
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function bmiClassification(bmi: number | null): { label: string; className: string } | null {
  if (bmi === null) return null
  if (bmi < 18.5) return { label: 'Abaixo do peso', className: 'bg-info-bg text-info-text' }
  if (bmi < 25) return { label: 'Normal', className: 'bg-success-bg text-success-text' }
  if (bmi < 30)
    return {
      label: 'Sobrepeso',
      className: 'bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]',
    }
  return { label: 'Obeso', className: 'bg-[hsl(var(--alert)/0.15)] text-[hsl(var(--alert))]' }
}

const TICK = { fontSize: 10, fill: '#64748b' } as const

/** Gráfico de uma métrica (glicemia, HbA1c, etc.) com último valor em destaque. */
export function MetricEvolutionChart({
  label,
  unit,
  points,
}: {
  label: string
  unit: string
  points: SeriesPoint[]
}) {
  if (points.length === 0) return null
  const last = points[points.length - 1]!
  const data = points.map((p) => ({ date: formatDateLabel(p.date), valor: p.value }))

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between gap-2 pb-2">
        <CardTitle className="text-sm">{label}</CardTitle>
        <p className="text-lg font-black tabular-nums text-slate-900">
          {formatValue(last.value)}{' '}
          <span className="text-[10px] font-normal text-slate-500">{unit}</span>
        </p>
      </CardHeader>
      <CardContent>
        {points.length >= 2 ? (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={TICK} />
                <YAxis tick={TICK} width={40} domain={['auto', 'auto']} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="valor"
                  name={`${label} (${unit})`}
                  stroke="#1C4F71"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Registrado em {formatDateLabel(last.date)}. A linha de evolução aparece a partir da
            segunda medição.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Evolução de peso/IMC (reuso de vital_signs) com classificação de faixa do IMC. */
export function WeightImcChart({ points }: { points: WeightImcPointUI[] }) {
  if (points.length === 0) return null
  const last = points[points.length - 1]!
  const cls = bmiClassification(last.bmi)
  const data = points.map((p) => ({
    date: formatDateLabel(p.measuredAt),
    pesoKg: p.weightKg,
    imc: p.bmi,
  }))

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between gap-2 pb-2">
        <CardTitle className="text-sm">Peso e IMC</CardTitle>
        <div className="flex items-baseline gap-3">
          {last.weightKg !== null ? (
            <p className="text-lg font-black tabular-nums text-slate-900">
              {last.weightKg.toFixed(1)}{' '}
              <span className="text-[10px] font-normal text-slate-500">kg</span>
            </p>
          ) : null}
          {last.bmi !== null ? (
            <p className="text-lg font-black tabular-nums text-slate-900">
              {last.bmi.toFixed(1)}{' '}
              <span className="text-[10px] font-normal text-slate-500">IMC</span>
            </p>
          ) : null}
          {cls ? (
            <Badge variant="secondary" className={cn('h-5 px-2 text-[10px]', cls.className)}>
              {cls.label}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {points.length >= 2 ? (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={TICK} />
                <YAxis yAxisId="kg" orientation="left" tick={TICK} width={36} />
                <YAxis yAxisId="imc" orientation="right" tick={TICK} width={36} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  yAxisId="kg"
                  type="monotone"
                  dataKey="pesoKg"
                  name="Peso (kg)"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
                <Line
                  yAxisId="imc"
                  type="monotone"
                  dataKey="imc"
                  name="IMC"
                  stroke="#1C4F71"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Um registro até agora. A linha de evolução aparece a partir da segunda medição.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
