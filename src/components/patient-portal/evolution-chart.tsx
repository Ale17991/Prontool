'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
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

/**
 * Feature 058 — as cores dos gráficos passaram a poder vir da clínica.
 *
 * Chegam em HEX e não como `var(--token)` porque o recharts escreve
 * `stroke`/`fill` como ATRIBUTO de apresentação do SVG, e ali a resolução de
 * variável CSS não é confiável entre navegadores. Quem usa estes gráficos fora
 * do portal (as telas da equipe) não passa nada e continua exatamente como
 * antes — a paleta da clínica alcança só o portal (FR-008).
 *
 * `positive` fica de fora da paleta da clínica de propósito: a linha de peso é
 * uma segunda série que precisa se distinguir da primeira, não um lugar de
 * marca.
 */
export interface ChartPalette {
  axis: string
  grid: string
  accent: string
}

const DEFAULT_CHART: ChartPalette = { axis: '#58697E', grid: '#e2e8f0', accent: '#003883' }

function tickOf(p: ChartPalette) {
  return { fontSize: 10, fill: p.axis } as const
}

/**
 * Feature 050 US2 — domínio do eixo Y que engloba os pontos E a faixa de
 * referência. Sem isto a banda pode ficar fora da área visível quando todos os
 * resultados estão de um lado só da faixa (que é justamente o caso alterado).
 *
 * Exportado para teste unitário: é a única lógica não-trivial do gráfico.
 */
export function yDomainWithRange(
  values: readonly number[],
  refMin?: number | null,
  refMax?: number | null,
): [number, number] | ['auto', 'auto'] {
  const bounds = [refMin, refMax].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  )
  if (bounds.length === 0) return ['auto', 'auto']
  const finite = values.filter((v) => Number.isFinite(v))
  const all = [...finite, ...bounds]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  // 8% de folga para a linha não encostar na borda; piso nunca abaixo de zero
  // quando os dados são todos não-negativos (exame não tem valor negativo).
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.08 || 1
  return [lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad]
}

/**
 * Gráfico de uma métrica (glicemia, HbA1c, etc.) com último valor em destaque.
 *
 * `refMin`/`refMax` (Feature 050) desenham a faixa normal como banda ao fundo.
 * São opcionais: os usos que não passam nada seguem exatamente como antes.
 */
export function MetricEvolutionChart({
  label,
  unit,
  points,
  refMin,
  refMax,
  palette,
}: {
  label: string
  unit: string
  points: SeriesPoint[]
  refMin?: number | null
  refMax?: number | null
  palette?: ChartPalette | null
}) {
  const c = palette ?? DEFAULT_CHART
  const TICK = tickOf(c)
  if (points.length === 0) return null
  const last = points[points.length - 1]!
  const data = points.map((p) => ({ date: formatDateLabel(p.date), valor: p.value }))
  const domain = yDomainWithRange(
    points.map((p) => p.value),
    refMin,
    refMax,
  )
  const hasBand = domain[0] !== 'auto'
  // Banda aberta de um lado (ex.: "≤ 100") se estende até a borda do domínio.
  const bandY1 = refMin ?? (hasBand ? (domain[0] as number) : undefined)
  const bandY2 = refMax ?? (hasBand ? (domain[1] as number) : undefined)

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between gap-2 pb-2">
        <CardTitle className="text-sm">{label}</CardTitle>
        <p className="text-lg font-black tabular-nums text-foreground">
          {formatValue(last.value)}{' '}
          <span className="text-[10px] font-normal text-muted-foreground">{unit}</span>
        </p>
      </CardHeader>
      <CardContent>
        {points.length >= 2 ? (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                <XAxis dataKey="date" tick={TICK} />
                <YAxis tick={TICK} width={40} domain={domain} />
                {hasBand ? (
                  <ReferenceArea
                    y1={bandY1}
                    y2={bandY2}
                    fill="#16a34a"
                    fillOpacity={0.08}
                    stroke="#16a34a"
                    strokeOpacity={0.25}
                    strokeDasharray="3 3"
                    ifOverflow="extendDomain"
                  />
                ) : null}
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="valor"
                  name={`${label} (${unit})`}
                  stroke={c.accent}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Registrado em {formatDateLabel(last.date)}. A linha de evolução aparece a partir da
            segunda medição.
          </p>
        )}
        {hasBand ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Faixa de referência:{' '}
            {refMin !== null && refMin !== undefined ? formatValue(refMin) : '—'}
            {' a '}
            {refMax !== null && refMax !== undefined ? formatValue(refMax) : '—'} {unit}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Evolução de peso/IMC (reuso de vital_signs) com classificação de faixa do IMC. */
export function WeightImcChart({
  points,
  palette,
}: {
  points: WeightImcPointUI[]
  palette?: ChartPalette | null
}) {
  const c = palette ?? DEFAULT_CHART
  const TICK = tickOf(c)
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
            <p className="text-lg font-black tabular-nums text-foreground">
              {last.weightKg.toFixed(1)}{' '}
              <span className="text-[10px] font-normal text-muted-foreground">kg</span>
            </p>
          ) : null}
          {last.bmi !== null ? (
            <p className="text-lg font-black tabular-nums text-foreground">
              {last.bmi.toFixed(1)}{' '}
              <span className="text-[10px] font-normal text-muted-foreground">IMC</span>
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
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
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
                  stroke={c.accent}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
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
