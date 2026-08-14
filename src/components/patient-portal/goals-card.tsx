import { Target, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { computeGoalProgress, type PatientGoal } from '@/lib/core/patient-portal/goals'
import type { WeightImcPoint } from '@/lib/core/patient-portal/read-portal'
import type { MeasurementDTO } from '@/lib/core/patient-portal/measurements'
import type { PatientMetricType } from '@/lib/core/patient-portal/metric-types'
import { MetricEvolutionChart } from './evolution-chart'

/**
 * Feature 032/034/057 — metas do paciente na tela inicial.
 *
 * DUAS CAMADAS, e a ordem importa. Em cima, a barra: pequena, uma linha por
 * meta, respondendo "quanto falta" de relance. Embaixo, o gráfico de cada meta,
 * para quem quiser ver como chegou até aqui. A versão anterior gastava um bloco
 * alto com a barra e não mostrava trajetória nenhuma — o paciente via o quanto
 * falta sem ver se está indo na direção certa.
 *
 * Só entra gráfico de meta com pelo menos dois pontos: um ponto isolado não é
 * evolução, é um valor, e a barra já o mostra.
 *
 * Cor vem de TOKEN (`--primary`, `--success`), nunca escrita na mão, para a
 * paleta da clínica alcançar isto quando existir.
 */
const LABEL_OVERRIDE: Record<string, string> = { glicemia_jejum: 'Glicemia em jejum' }

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

interface Props {
  goals: PatientGoal[]
  weightImc: WeightImcPoint[]
  metrics: Record<string, MeasurementDTO[]>
  metricTypes: PatientMetricType[]
}

interface Series {
  label: string
  unit: string
  /** Ordem cronológica: o primeiro é a linha de base. */
  points: { date: string; value: number }[]
}

function seriesFor(goal: PatientGoal, ctx: Props): Series | null {
  if (goal.metricType === 'peso_kg') {
    return {
      label: 'Peso',
      unit: 'kg',
      points: ctx.weightImc
        .filter((p) => p.weightKg !== null)
        .map((p) => ({ date: p.measuredAt, value: p.weightKg! })),
    }
  }
  if (goal.metricType === 'imc') {
    return {
      label: 'IMC',
      unit: '',
      points: ctx.weightImc
        .filter((p) => p.bmi !== null)
        .map((p) => ({ date: p.measuredAt, value: p.bmi! })),
    }
  }
  const type = ctx.metricTypes.find((t) => t.metricType === goal.metricType)
  if (!type) return null
  const series = ctx.metrics[goal.metricType] ?? []
  return {
    label: LABEL_OVERRIDE[goal.metricType] ?? type.label,
    unit: type.unit,
    points: series.map((m) => ({ date: m.measuredAt, value: m.value })),
  }
}

export function GoalsCard(props: Props) {
  const rows = props.goals
    .map((goal) => {
      const s = seriesFor(goal, props)
      if (!s || s.points.length === 0) return null
      const values = s.points.map((p) => p.value)
      const prog = computeGoalProgress({
        direction: goal.direction,
        target: goal.targetValue,
        baseline: values[0]!,
        current: values[values.length - 1]!,
      })
      return { goal, series: s, prog }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (rows.length === 0) return null

  const charts = rows.filter((r) => r.series.points.length >= 2)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Target className="h-4 w-4 text-primary" />
            Minhas metas
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(({ goal, series, prog }) => {
            const u = series.unit ? ` ${series.unit}` : ''
            return (
              <div key={goal.id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-semibold text-foreground">{series.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {fmtNum(prog.current)}
                    {u} <span className="opacity-50">/</span>{' '}
                    <span className="font-semibold text-foreground">
                      {fmtNum(prog.target)}
                      {u}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${prog.achieved ? 'bg-success' : 'bg-primary'}`}
                    style={{ width: `${Math.round(prog.progress * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] font-medium">
                  {prog.achieved ? (
                    <span className="inline-flex items-center gap-1 text-success-strong">
                      <Check className="h-3 w-3" /> Meta atingida
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Faltam {fmtNum(prog.remaining)}
                      {u}
                    </span>
                  )}
                </p>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {charts.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {charts.map(({ goal, series }) => (
            <MetricEvolutionChart
              key={goal.id}
              label={series.label}
              unit={series.unit}
              points={series.points}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
