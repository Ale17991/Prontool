import { CalendarDays, ClipboardList, Activity } from 'lucide-react'
import type { PortalAppointment, WeightImcPoint } from '@/lib/core/patient-portal/read-portal'
import type { CareNote } from '@/lib/core/patient-portal/care-notes'
import type { MeasurementDTO } from '@/lib/core/patient-portal/measurements'
import type { PatientMetricType } from '@/lib/core/patient-portal/metric-types'

/**
 * Feature 032 — portal do paciente em LINHA DO TEMPO.
 * Mescla atendimentos, medições, peso/IMC e orientações por data (mais recente
 * primeiro), com seta de evolução por métrica. Fácil de ler a progressão.
 *
 * Termos médicos corretos para exibição, sem alterar o catálogo (append-only):
 */
const METRIC_LABEL_OVERRIDE: Record<string, string> = {
  glicemia_jejum: 'Glicemia em jejum',
}

interface MetricItem {
  label: string
  value: number
  unit: string
  /** Variação vs a leitura anterior da mesma métrica (null = primeira). */
  delta: number | null
}

type TimelineNode =
  | { dateKey: string; sortAt: number; kind: 'atendimento'; appt: PortalAppointment }
  | { dateKey: string; sortAt: number; kind: 'medicoes'; items: MetricItem[] }
  | { dateKey: string; sortAt: number; kind: 'orientacao'; note: CareNote }

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}
function formatDay(dateKey: string): string {
  // dateKey = YYYY-MM-DD
  const [y, m, d] = dateKey.split('-')
  return `${d}/${m}/${y}`
}
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export interface PatientTimelineProps {
  appointments: PortalAppointment[]
  weightImc: WeightImcPoint[]
  metrics: Record<string, MeasurementDTO[]>
  metricTypes: PatientMetricType[]
  careNotes: CareNote[]
}

export function PatientTimeline({
  appointments,
  weightImc,
  metrics,
  metricTypes,
  careNotes,
}: PatientTimelineProps) {
  // 1. Medições agrupadas por dia (métricas metabólicas + peso/IMC), com delta.
  const byDay = new Map<string, MetricItem[]>()
  const push = (key: string, item: MetricItem) => {
    const arr = byDay.get(key) ?? []
    arr.push(item)
    byDay.set(key, arr)
  }

  for (const t of metricTypes) {
    const series = metrics[t.metricType] ?? [] // ordem cronológica asc
    const label = METRIC_LABEL_OVERRIDE[t.metricType] ?? t.label
    series.forEach((pt, i) => {
      const prev = i > 0 ? series[i - 1]!.value : null
      push(dayKey(pt.measuredAt), {
        label,
        value: pt.value,
        unit: t.unit,
        delta: prev === null ? null : pt.value - prev,
      })
    })
  }
  weightImc.forEach((pt, i) => {
    const prev = i > 0 ? weightImc[i - 1]! : null
    if (pt.weightKg !== null) {
      push(dayKey(pt.measuredAt), {
        label: 'Peso',
        value: pt.weightKg,
        unit: 'kg',
        delta: prev && prev.weightKg !== null ? pt.weightKg - prev.weightKg : null,
      })
    }
    if (pt.bmi !== null) {
      push(dayKey(pt.measuredAt), {
        label: 'IMC',
        value: pt.bmi,
        unit: '',
        delta: prev && prev.bmi !== null ? pt.bmi - prev.bmi : null,
      })
    }
  })

  // 2. Monta nós da linha do tempo.
  const nodes: TimelineNode[] = []
  for (const [dateKey, items] of byDay) {
    nodes.push({ dateKey, sortAt: new Date(dateKey).getTime(), kind: 'medicoes', items })
  }
  for (const appt of appointments) {
    nodes.push({ dateKey: dayKey(appt.appointmentAt), sortAt: new Date(appt.appointmentAt).getTime(), kind: 'atendimento', appt })
  }
  for (const note of careNotes) {
    nodes.push({ dateKey: dayKey(note.createdAt), sortAt: new Date(note.createdAt).getTime(), kind: 'orientacao', note })
  }
  nodes.sort((a, b) => b.sortAt - a.sortAt)

  if (nodes.length === 0) return null

  const DOT: Record<TimelineNode['kind'], string> = {
    atendimento: 'bg-emerald-500',
    medicoes: 'bg-violet-500',
    orientacao: 'bg-amber-500',
  }

  return (
    <ol className="relative space-y-5 border-l-2 border-slate-100 pl-5">
      {nodes.map((n, idx) => (
        <li key={`${n.kind}-${n.dateKey}-${idx}`} className="relative">
          <span
            className={`absolute -left-[26px] top-1.5 h-3.5 w-3.5 rounded-full ring-4 ring-white ${DOT[n.kind]}`}
          />
          <time className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            {formatDay(n.dateKey)}
          </time>

          {n.kind === 'medicoes' ? (
            <div className="mt-1.5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                  <Activity className="h-3.5 w-3.5" />
                </span>
                Medições
              </p>
              <ul className="space-y-1.5">
                {n.items.map((it, k) => (
                  <li key={k} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-slate-500">{it.label}</span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {fmtNum(it.value)}
                      {it.unit ? <span className="ml-0.5 text-xs font-normal text-slate-400">{it.unit}</span> : null}
                      {it.delta !== null && Math.abs(it.delta) >= 0.05 ? (
                        <span className="ml-1.5 text-[11px] font-medium text-slate-400">
                          {it.delta > 0 ? '▲' : '▼'} {fmtNum(Math.abs(it.delta))}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : n.kind === 'atendimento' ? (
            <div className="mt-1.5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <CalendarDays className="h-3.5 w-3.5" />
                </span>
                Atendimento
              </p>
              {n.appt.doctorName || n.appt.procedureName ? (
                <p className="mt-1 pl-9 text-sm text-slate-500">
                  {[n.appt.doctorName, n.appt.procedureName].filter(Boolean).join(' · ')}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-1.5 rounded-2xl border border-amber-100 bg-amber-50/60 p-4 shadow-sm">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                  <ClipboardList className="h-3.5 w-3.5" />
                </span>
                Orientação da equipe
              </p>
              <p className="mt-1.5 whitespace-pre-wrap pl-9 text-sm text-slate-700">{n.note.body}</p>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}
