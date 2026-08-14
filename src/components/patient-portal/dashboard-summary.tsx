import { LayoutDashboard } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WeightImcPoint } from '@/lib/core/patient-portal/read-portal'
import type { MeasurementDTO } from '@/lib/core/patient-portal/measurements'
import type { PatientMetricType } from '@/lib/core/patient-portal/metric-types'

/**
 * Feature 032 — dashboard de resumo (primeira impressão do portal).
 * Cartões com o valor ATUAL de cada métrica + tendência vs leitura anterior.
 */
const METRIC_LABEL_OVERRIDE: Record<string, string> = { glicemia_jejum: 'Glicemia em jejum' }

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

interface Kpi {
  label: string
  value: number
  unit: string
  delta: number | null
}

interface Props {
  weightImc: WeightImcPoint[]
  metrics: Record<string, MeasurementDTO[]>
  metricTypes: PatientMetricType[]
}

export function DashboardSummary({ weightImc, metrics, metricTypes }: Props) {
  const kpis: Kpi[] = []

  const lastTwo = <T,>(arr: T[]): [T | null, T | null] => [
    arr.length >= 2 ? arr[arr.length - 2]! : null,
    arr.length >= 1 ? arr[arr.length - 1]! : null,
  ]

  const weights = weightImc.filter((p) => p.weightKg !== null)
  if (weights.length > 0) {
    const [prev, cur] = lastTwo(weights)
    kpis.push({
      label: 'Peso',
      value: cur!.weightKg!,
      unit: 'kg',
      delta: prev && prev.weightKg !== null ? cur!.weightKg! - prev.weightKg : null,
    })
  }
  const bmis = weightImc.filter((p) => p.bmi !== null)
  if (bmis.length > 0) {
    const [prev, cur] = lastTwo(bmis)
    kpis.push({
      label: 'IMC',
      value: cur!.bmi!,
      unit: '',
      delta: prev && prev.bmi !== null ? cur!.bmi! - prev.bmi : null,
    })
  }
  for (const t of metricTypes) {
    const series = metrics[t.metricType] ?? []
    if (series.length === 0) continue
    const [prev, cur] = lastTwo(series)
    kpis.push({
      label: METRIC_LABEL_OVERRIDE[t.metricType] ?? t.label,
      value: cur!.value,
      unit: t.unit,
      delta: prev ? cur!.value - prev.value : null,
    })
  }

  if (kpis.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <LayoutDashboard className="h-4 w-4 text-primary" />
          Resumo
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <div key={i} className="rounded-xl border border-border bg-muted/40 p-3">
            <p className="truncate text-[11px] font-medium text-muted-foreground">{k.label}</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
              {fmtNum(k.value)}
              {k.unit ? (
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">{k.unit}</span>
              ) : null}
            </p>
            {k.delta !== null && Math.abs(k.delta) >= 0.05 ? (
              <p className="text-[11px] font-medium text-muted-foreground">
                {k.delta > 0 ? '▲' : '▼'} {fmtNum(Math.abs(k.delta))} vs anterior
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground opacity-60">—</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
