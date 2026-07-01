'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { siteLabel, type PerioSite } from '@/lib/core/dental/perio/sites'

interface ExamOpt {
  id: string
  examDate: string
}

interface CompareSite {
  toothFdi: number
  site: PerioSite
  fromPd: number | null
  toPd: number | null
  deltaPd: number | null
  fromBleeding: boolean
  toBleeding: boolean
}

interface CompareView {
  from: {
    id: string
    examDate: string
    indicators: { bopPct: number; pocketsGe4: number; calAvgMm: number | null }
  }
  to: {
    id: string
    examDate: string
    indicators: { bopPct: number; pocketsGe4: number; calAvgMm: number | null }
  }
  sites: CompareSite[]
  deltas: { bopPct: number; pocketsGe4: number; calAvgMm: number | null }
}

/** Comparação entre dois exames finalizados (US2). */
export function PerioCompare({ patientId, exams }: { patientId: string; exams: ExamOpt[] }) {
  const finalized = exams // o pai já passa só finalizados
  const [fromId, setFromId] = useState(finalized[1]?.id ?? '')
  const [toId, setToId] = useState(finalized[0]?.id ?? '')
  const [data, setData] = useState<CompareView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!fromId || !toId || fromId === toId) {
      setData(null)
      setError(fromId === toId ? 'Selecione dois exames diferentes.' : null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/pacientes/${patientId}/periograma/comparar?from=${fromId}&to=${toId}`,
        {
          headers: { accept: 'application/json' },
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`)
      }
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao comparar.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [patientId, fromId, toId])

  useEffect(() => {
    void load()
  }, [load])

  if (finalized.length < 2) {
    return (
      <p className="text-sm text-slate-500">
        São necessários ao menos dois exames finalizados para comparar.
      </p>
    )
  }

  const changed = data?.sites.filter((s) => s.deltaPd !== null && s.deltaPd !== 0) ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Picker label="De" value={fromId} onChange={setFromId} options={finalized} />
        <Picker label="Para" value={toId} onChange={setToId} options={finalized} />
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-500">Comparando…</p> : null}

      {data ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Delta
              label="BOP"
              value={`${data.deltas.bopPct > 0 ? '+' : ''}${data.deltas.bopPct}%`}
              good={data.deltas.bopPct <= 0}
            />
            <Delta
              label="Bolsas ≥4mm"
              value={`${data.deltas.pocketsGe4 > 0 ? '+' : ''}${data.deltas.pocketsGe4}`}
              good={data.deltas.pocketsGe4 <= 0}
            />
            <Delta
              label="CAL médio"
              value={
                data.deltas.calAvgMm === null
                  ? '—'
                  : `${data.deltas.calAvgMm > 0 ? '+' : ''}${data.deltas.calAvgMm} mm`
              }
              good={(data.deltas.calAvgMm ?? 0) <= 0}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left font-semibold text-slate-500">
                <tr>
                  <th className="px-3 py-2">Dente · Sítio</th>
                  <th className="px-3 py-2 text-center">{data.from.examDate}</th>
                  <th className="px-3 py-2 text-center">{data.to.examDate}</th>
                  <th className="px-3 py-2 text-center">Δ PS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {changed.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                      Sem variação de profundidade entre os exames.
                    </td>
                  </tr>
                ) : null}
                {changed.map((s) => (
                  <tr key={`${s.toothFdi}:${s.site}`}>
                    <td className="px-3 py-1.5">
                      Dente {s.toothFdi} · {siteLabel(s.site)}
                    </td>
                    <td className="px-3 py-1.5 text-center">{s.fromPd ?? '—'}</td>
                    <td className="px-3 py-1.5 text-center">{s.toPd ?? '—'}</td>
                    <td
                      className={cn(
                        'px-3 py-1.5 text-center font-semibold',
                        (s.deltaPd ?? 0) < 0 ? 'text-emerald-600' : 'text-red-600',
                      )}
                    >
                      {s.deltaPd! > 0 ? '+' : ''}
                      {s.deltaPd}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: ExamOpt[]
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border px-2 py-1 text-slate-800"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.examDate}
          </option>
        ))}
      </select>
    </label>
  )
}

function Delta({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn('text-lg font-bold', good ? 'text-emerald-600' : 'text-red-600')}>
        {value}
      </div>
    </div>
  )
}
