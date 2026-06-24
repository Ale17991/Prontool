'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  calcIndicators,
  type PerioSite,
  type PerioIndicators,
} from '@/lib/core/dental/perio/sites'
import { PerioChartGrid, siteKey, type SiteCell, type ToothFinding } from './perio-chart-grid'
import { PerioIndicatorsPanel } from './perio-indicators'
import { PerioCompare } from './perio-compare'

interface ExamSummary {
  id: string
  examDate: string
  status: 'rascunho' | 'finalizado'
  dentition: 'permanent' | 'deciduous'
}

type View = 'list' | 'exam' | 'compare'

export function PerioTab({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const [exams, setExams] = useState<ExamSummary[]>([])
  const [draftId, setDraftId] = useState<string | null>(null)
  const [view, setView] = useState<View>('list')
  const [examId, setExamId] = useState<string | null>(null)
  const [dentition, setDentition] = useState<'permanent' | 'deciduous'>('permanent')
  const [status, setStatus] = useState<'rascunho' | 'finalizado'>('rascunho')
  const [measurements, setMeasurements] = useState<Record<string, SiteCell>>({})
  const [findings, setFindings] = useState<Record<number, ToothFinding>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const dirtyMeas = useRef<Set<string>>(new Set())
  const dirtyFind = useRef<Set<number>>(new Set())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/periograma`, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setExams(data.exams ?? [])
      setDraftId(data.draftId ?? null)
    } catch {
      setError('Não foi possível carregar os exames.')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const openExam = useCallback(
    async (id: string) => {
      setError(null)
      try {
        const res = await fetch(`/api/pacientes/${patientId}/periograma/${id}`, { headers: { accept: 'application/json' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const m: Record<string, SiteCell> = {}
        for (const x of data.measurements ?? []) {
          m[siteKey(x.toothFdi, x.site)] = {
            probingDepthMm: x.probingDepthMm,
            recessionMm: x.recessionMm,
            bleeding: x.bleeding,
            suppuration: x.suppuration,
            plaque: x.plaque,
          }
        }
        const f: Record<number, ToothFinding> = {}
        for (const x of data.findings ?? []) {
          f[x.toothFdi] = { mobility: x.mobility, furcation: x.furcation, isMissing: x.isMissing, isImplant: x.isImplant }
        }
        setMeasurements(m)
        setFindings(f)
        setDentition(data.exam.dentition)
        setStatus(data.exam.status)
        setExamId(id)
        dirtyMeas.current.clear()
        dirtyFind.current.clear()
        setView('exam')
      } catch {
        setError('Não foi possível abrir o exame.')
      }
    },
    [patientId],
  )

  const createExam = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/periograma`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dentition }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`)
      await loadList()
      await openExam(j.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar exame.')
    } finally {
      setBusy(false)
    }
  }, [patientId, dentition, loadList, openExam])

  const flush = useCallback(async () => {
    if (!examId || status !== 'rascunho') return
    const mKeys = [...dirtyMeas.current]
    const fKeys = [...dirtyFind.current]
    if (mKeys.length === 0 && fKeys.length === 0) return
    dirtyMeas.current.clear()
    dirtyFind.current.clear()

    const body: Record<string, unknown> = {}
    if (mKeys.length) {
      body.measurements = mKeys.map((k) => {
        const [tooth, site] = k.split(':')
        const c = measurements[k]
        return {
          toothFdi: Number(tooth),
          site: site as PerioSite,
          probingDepthMm: c?.probingDepthMm ?? null,
          recessionMm: c?.recessionMm ?? null,
          bleeding: c?.bleeding ?? false,
          suppuration: c?.suppuration ?? false,
          plaque: c?.plaque ?? false,
        }
      })
    }
    if (fKeys.length) {
      body.findings = fKeys.map((t) => {
        const f = findings[t]
        return {
          toothFdi: t,
          mobility: f?.mobility ?? null,
          furcation: f?.furcation ?? null,
          isMissing: f?.isMissing ?? false,
          isImplant: f?.isImplant ?? false,
        }
      })
    }

    try {
      const res = await fetch(`/api/pacientes/${patientId}/periograma/${examId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`)
      }
      setSavedAt(new Date().toLocaleTimeString('pt-BR'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar.')
    }
  }, [examId, status, measurements, findings, patientId])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flush(), 800)
  }, [flush])

  const onSite = useCallback(
    (toothFdi: number, site: PerioSite, patch: Partial<SiteCell>) => {
      const key = siteKey(toothFdi, site)
      setMeasurements((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? { probingDepthMm: null, recessionMm: null, bleeding: false, suppuration: false, plaque: false }), ...patch },
      }))
      dirtyMeas.current.add(key)
      scheduleSave()
    },
    [scheduleSave],
  )

  const onFinding = useCallback(
    (toothFdi: number, patch: Partial<ToothFinding>) => {
      setFindings((prev) => ({
        ...prev,
        [toothFdi]: { ...(prev[toothFdi] ?? { mobility: null, furcation: null, isMissing: false, isImplant: false }), ...patch },
      }))
      dirtyFind.current.add(toothFdi)
      scheduleSave()
    },
    [scheduleSave],
  )

  const finalize = useCallback(async () => {
    if (!examId) return
    setBusy(true)
    setError(null)
    try {
      await flush()
      const res = await fetch(`/api/pacientes/${patientId}/periograma/${examId}/finalizar`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`)
      }
      setStatus('finalizado')
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao finalizar.')
    } finally {
      setBusy(false)
    }
  }, [examId, patientId, flush, loadList])

  const discard = useCallback(async () => {
    if (!examId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/periograma/${examId}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`)
      }
      setView('list')
      setExamId(null)
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao descartar.')
    } finally {
      setBusy(false)
    }
  }, [examId, patientId, loadList])

  const liveIndicators: PerioIndicators = useMemo(() => {
    const meas = Object.entries(measurements).map(([k, c]) => {
      const [tooth, site] = k.split(':')
      return { toothFdi: Number(tooth), site: site as PerioSite, probingDepthMm: c.probingDepthMm, recessionMm: c.recessionMm, bleeding: c.bleeding }
    })
    const find = Object.entries(findings).map(([t, f]) => ({ toothFdi: Number(t), isMissing: f.isMissing }))
    return calcIndicators(meas, find)
  }, [measurements, findings])

  const finalizedExams = useMemo(() => exams.filter((e) => e.status === 'finalizado'), [exams])

  if (loading) return <p className="text-sm text-slate-500">Carregando periograma…</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Toggle active={view === 'list'} onClick={() => setView('list')}>Exames</Toggle>
        {examId ? <Toggle active={view === 'exam'} onClick={() => setView('exam')}>Exame atual</Toggle> : null}
        <Toggle active={view === 'compare'} onClick={() => setView('compare')}>Comparar</Toggle>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {view === 'list' ? (
        <div className="space-y-3">
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <select value={dentition} onChange={(e) => setDentition(e.target.value as 'permanent' | 'deciduous')} className="rounded border px-2 py-1 text-xs">
                <option value="permanent">Permanente</option>
                <option value="deciduous">Decídua</option>
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={draftId ? () => openExam(draftId) : createExam}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {draftId ? 'Continuar rascunho' : '+ Novo exame'}
              </button>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left font-semibold text-slate-500">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2">Dentição</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {exams.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Nenhum exame periodontal.</td></tr>
                ) : null}
                {exams.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">{e.examDate}</td>
                    <td className="px-3 py-2">{e.status === 'rascunho' ? 'Rascunho' : 'Finalizado'}</td>
                    <td className="px-3 py-2">{e.dentition === 'permanent' ? 'Permanente' : 'Decídua'}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => openExam(e.id)} className="text-slate-600 hover:underline">Abrir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {view === 'exam' && examId ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              {status === 'rascunho' ? 'Rascunho' : 'Finalizado (somente leitura)'}
              {savedAt && status === 'rascunho' ? ` · salvo ${savedAt}` : ''}
            </span>
            {canWrite && status === 'rascunho' ? (
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={finalize} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Finalizar</button>
                <button type="button" disabled={busy} onClick={discard} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-500">Descartar</button>
              </div>
            ) : null}
          </div>

          <PerioIndicatorsPanel indicators={liveIndicators} />

          <PerioChartGrid
            dentition={dentition}
            measurements={measurements}
            findings={findings}
            readOnly={!canWrite || status !== 'rascunho'}
            onSite={onSite}
            onFinding={onFinding}
          />
          <p className="text-[11px] text-slate-400">PS = profundidade de sondagem · Rec = recessão (mm, negativa = margem coronal) · barra = sangramento.</p>
        </div>
      ) : null}

      {view === 'compare' ? (
        <PerioCompare patientId={patientId} exams={finalizedExams.map((e) => ({ id: e.id, examDate: e.examDate }))} />
      ) : null}
    </div>
  )
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
    >
      {children}
    </button>
  )
}
