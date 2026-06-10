import { Target, Check } from 'lucide-react'
import { computeGoalProgress, type PatientGoal } from '@/lib/core/patient-portal/goals'
import type { WeightImcPoint } from '@/lib/core/patient-portal/read-portal'
import type { MeasurementDTO } from '@/lib/core/patient-portal/measurements'
import type { PatientMetricType } from '@/lib/core/patient-portal/metric-types'

/**
 * Feature 032/034 — Dash de Metas no topo do portal.
 * Para cada meta ativa: valor atual × alvo + barra de progresso + texto
 * ("faltam X para sua meta") + ✓ quando atingida. Cobre métricas do catálogo
 * e peso/IMC (de vital_signs).
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

function seriesFor(
  goal: PatientGoal,
  ctx: Props,
): { values: number[]; label: string; unit: string } | null {
  if (goal.metricType === 'peso_kg') {
    return {
      values: ctx.weightImc.map((p) => p.weightKg).filter((v): v is number => v !== null),
      label: 'Peso',
      unit: 'kg',
    }
  }
  if (goal.metricType === 'imc') {
    return {
      values: ctx.weightImc.map((p) => p.bmi).filter((v): v is number => v !== null),
      label: 'IMC',
      unit: '',
    }
  }
  const t = ctx.metricTypes.find((m) => m.metricType === goal.metricType)
  const series = ctx.metrics[goal.metricType] ?? []
  return {
    values: series.map((s) => s.value),
    label: LABEL_OVERRIDE[goal.metricType] ?? t?.label ?? goal.metricType,
    unit: t?.unit ?? '',
  }
}

export function GoalsCard(props: Props) {
  const rows = props.goals
    .map((goal) => {
      const s = seriesFor(goal, props)
      if (!s || s.values.length === 0) return null
      const baseline = s.values[0]!
      const current = s.values[s.values.length - 1]!
      const prog = computeGoalProgress({
        direction: goal.direction,
        target: goal.targetValue,
        baseline,
        current,
      })
      return { goal, label: s.label, unit: s.unit, prog }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (rows.length === 0) return null

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2.5 text-sm font-bold text-slate-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
          <Target className="h-4 w-4" />
        </span>
        Minhas metas
      </h2>

      <div className="space-y-5">
        {rows.map(({ goal, label, unit, prog }) => {
          const u = unit ? ` ${unit}` : ''
          return (
            <div key={goal.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800">{label}</span>
                <span className="text-sm tabular-nums text-slate-500">
                  {fmtNum(prog.current)}
                  {u} <span className="text-slate-300">→</span>{' '}
                  <span className="font-semibold text-slate-700">
                    {fmtNum(prog.target)}
                    {u}
                  </span>
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${prog.achieved ? 'bg-emerald-500' : 'bg-sky-500'}`}
                  style={{ width: `${Math.round(prog.progress * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] font-medium">
                {prog.achieved ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <Check className="h-3 w-3" /> Meta atingida!
                  </span>
                ) : (
                  <span className="text-slate-400">
                    Faltam {fmtNum(prog.remaining)}
                    {u} para sua meta de {fmtNum(prog.target)}
                    {u}.
                  </span>
                )}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
