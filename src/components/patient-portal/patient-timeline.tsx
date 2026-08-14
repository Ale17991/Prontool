'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, ClipboardList, Activity } from 'lucide-react'
import type { PortalAppointment, WeightImcPoint } from '@/lib/core/patient-portal/read-portal'
import type { CareNote } from '@/lib/core/patient-portal/care-notes'
import type { MeasurementDTO } from '@/lib/core/patient-portal/measurements'
import type { PatientMetricType } from '@/lib/core/patient-portal/metric-types'

/**
 * Feature 032 — portal do paciente em LINHA DO TEMPO, COM FILTROS.
 * O paciente acha o dado que quer mais rápido: filtra por TIPO (atendimentos /
 * medições / orientações) e por PERÍODO (3/6/12 meses / tudo).
 */
const METRIC_LABEL_OVERRIDE: Record<string, string> = { glicemia_jejum: 'Glicemia em jejum' }

type Kind = 'atendimento' | 'medicoes' | 'orientacao'

/**
 * Feature 058 — os três tipos deixaram de ter cada um o seu pastel (esmeralda,
 * violeta, âmbar, escritos na mão) e passaram a ser INTENSIDADES da cor da
 * clínica.
 *
 * Cor fixa em classe é invisível para qualquer tema: numa clínica de paleta
 * própria, os três apareceriam como cores de outra marca — e o bloco de
 * orientação, que era `bg-amber-50`, viraria um retângulo claro cravado num
 * portal escuro. A distinção entre os tipos continua existindo, e é feita por
 * onde ela de fato se lê: o ícone e o título de cada nó, mais o degrau de
 * intensidade no ponto da linha do tempo.
 */
const KIND_META: Record<Kind, { label: string; dot: string; chipOn: string; icon: string }> = {
  atendimento: {
    label: 'Atendimentos',
    dot: 'bg-primary',
    chipOn: 'border-primary bg-primary text-primary-foreground',
    icon: 'bg-accent text-accent-foreground',
  },
  medicoes: {
    label: 'Medições',
    dot: 'bg-primary/60',
    chipOn: 'border-primary bg-primary text-primary-foreground',
    icon: 'bg-accent text-accent-foreground',
  },
  orientacao: {
    label: 'Orientações',
    dot: 'bg-primary/30',
    chipOn: 'border-primary bg-primary text-primary-foreground',
    icon: 'bg-accent text-accent-foreground',
  },
}

const PERIODS: Array<{ key: string; label: string; months: number | null }> = [
  { key: '3', label: '3 meses', months: 3 },
  { key: '6', label: '6 meses', months: 6 },
  { key: '12', label: '12 meses', months: 12 },
  { key: 'all', label: 'Tudo', months: null },
]

interface MetricItem {
  label: string
  value: number
  unit: string
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
  const [activeKinds, setActiveKinds] = useState<Set<Kind>>(
    () => new Set<Kind>(['atendimento', 'medicoes', 'orientacao']),
  )
  const [period, setPeriod] = useState<string>('all')

  // Constrói todos os nós uma vez (memo); filtros são aplicados depois.
  const allNodes = useMemo<TimelineNode[]>(() => {
    const byDay = new Map<string, MetricItem[]>()
    const push = (key: string, item: MetricItem) => {
      const arr = byDay.get(key) ?? []
      arr.push(item)
      byDay.set(key, arr)
    }
    for (const t of metricTypes) {
      const series = metrics[t.metricType] ?? []
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

    const nodes: TimelineNode[] = []
    for (const [dateKey, items] of byDay) {
      nodes.push({ dateKey, sortAt: new Date(dateKey).getTime(), kind: 'medicoes', items })
    }
    for (const appt of appointments) {
      nodes.push({
        dateKey: dayKey(appt.appointmentAt),
        sortAt: new Date(appt.appointmentAt).getTime(),
        kind: 'atendimento',
        appt,
      })
    }
    for (const note of careNotes) {
      nodes.push({
        dateKey: dayKey(note.createdAt),
        sortAt: new Date(note.createdAt).getTime(),
        kind: 'orientacao',
        note,
      })
    }
    nodes.sort((a, b) => b.sortAt - a.sortAt)
    return nodes
  }, [appointments, weightImc, metrics, metricTypes, careNotes])

  // Quais tipos existem nos dados (só mostra chips com conteúdo).
  const availableKinds = useMemo(() => {
    const s = new Set<Kind>()
    for (const n of allNodes) s.add(n.kind)
    return s
  }, [allNodes])

  const visible = useMemo(() => {
    const months = PERIODS.find((p) => p.key === period)?.months ?? null
    let cutoff = -Infinity
    if (months !== null) {
      const d = new Date()
      d.setMonth(d.getMonth() - months)
      cutoff = d.getTime()
    }
    return allNodes.filter((n) => activeKinds.has(n.kind) && n.sortAt >= cutoff)
  }, [allNodes, activeKinds, period])

  if (allNodes.length === 0) return null

  function toggleKind(k: Kind) {
    setActiveKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) {
        if (next.size > 1) next.delete(k) // nunca deixa todos desligados
      } else next.add(k)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {(['atendimento', 'medicoes', 'orientacao'] as Kind[])
          .filter((k) => availableKinds.has(k))
          .map((k) => {
            const on = activeKinds.has(k)
            const meta = KIND_META[k]
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  on ? meta.chipOn : 'border-border bg-card text-muted-foreground'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-current' : meta.dot}`} />
                {meta.label}
              </button>
            )
          })}
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="ml-auto h-8 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground"
          aria-label="Período"
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-5 text-center text-sm text-muted-foreground">
          Nada neste filtro. Ajuste o tipo ou o período.
        </p>
      ) : (
        <ol className="relative space-y-5 border-l-2 border-border pl-5">
          {visible.map((n, idx) => (
            <li key={`${n.kind}-${n.dateKey}-${idx}`} className="relative">
              <span
                className={`absolute -left-[26px] top-1.5 h-3.5 w-3.5 rounded-full ring-4 ring-background ${KIND_META[n.kind].dot}`}
              />
              <time className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                {formatDay(n.dateKey)}
              </time>

              {n.kind === 'medicoes' ? (
                <div className="mt-1.5 rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg ${KIND_META.medicoes.icon}`}
                    >
                      <Activity className="h-3.5 w-3.5" />
                    </span>
                    Medições
                  </p>
                  <ul className="space-y-1.5">
                    {n.items.map((it, k) => (
                      <li key={k} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">{it.label}</span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {fmtNum(it.value)}
                          {it.unit ? (
                            <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                              {it.unit}
                            </span>
                          ) : null}
                          {it.delta !== null && Math.abs(it.delta) >= 0.05 ? (
                            <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
                              {it.delta > 0 ? '▲' : '▼'} {fmtNum(Math.abs(it.delta))}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : n.kind === 'atendimento' ? (
                <div className="mt-1.5 rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg ${KIND_META.atendimento.icon}`}
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                    </span>
                    Atendimento
                  </p>
                  {n.appt.doctorName || n.appt.procedureName ? (
                    <p className="mt-1 pl-9 text-sm text-muted-foreground">
                      {[n.appt.doctorName, n.appt.procedureName].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                </div>
              ) : (
                // A orientação da equipe continua sendo o nó que se destaca —
                // é a única coisa aqui que alguém ESCREVEU para este paciente.
                // O destaque passou a ser a cor da clínica em fundo suave, em
                // vez do âmbar fixo que só existia em tema claro.
                <div className="mt-1.5 rounded-2xl border border-primary/25 bg-accent/60 p-4 shadow-sm">
                  <p className="flex items-center gap-2 text-sm font-semibold text-accent-foreground">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg ${KIND_META.orientacao.icon}`}
                    >
                      <ClipboardList className="h-3.5 w-3.5" />
                    </span>
                    Orientação da equipe
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap pl-9 text-sm text-foreground">
                    {n.note.body}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
