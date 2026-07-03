'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { DentalStatusDTO } from '@/lib/core/dental/status-catalog/list'
import { surfaceLabel, type Dentition, type Surface } from '@/lib/core/dental/teeth'
import { StatusPalette } from './status-palette'
import { OdontogramChart } from './odontogram-chart'
import type { FaceMark } from './tooth'

interface CurrentEntry {
  id: string
  toothFdi: number
  surface: Surface | null
  statusId: string
  note: string | null
  recordedAt: string
  appointmentId: string | null
}

interface ApiResponse {
  patientId: string
  current: CurrentEntry[]
  statuses: DentalStatusDTO[]
}

interface HistoryEntry {
  id: string
  toothFdi: number
  surface: Surface | null
  statusLabel: string | null
  note: string | null
  recordedAt: string
}

interface Props {
  patientId: string
  canWrite: boolean
  /** Contexto opcional de atendimento — marca vincula a ele (US3/FR-018). */
  appointmentId?: string | null
}

function posKey(toothFdi: number, surface: Surface | null): string {
  return `${toothFdi}:${surface ?? 'tooth'}`
}

export function OdontogramTab({ patientId, canWrite, appointmentId }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<DentalStatusDTO[]>([])
  const [entries, setEntries] = useState<Record<string, CurrentEntry>>({})
  const [selected, setSelected] = useState<DentalStatusDTO | null>(null)
  const [dentition, setDentition] = useState<Dentition>('permanent')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [historyTooth, setHistoryTooth] = useState<number | null>(null)
  const [historyItems, setHistoryItems] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/odontograma`, {
        headers: { accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: ApiResponse = await res.json()
      setStatuses(data.statuses)
      const map: Record<string, CurrentEntry> = {}
      for (const e of data.current) map[posKey(e.toothFdi, e.surface)] = e
      setEntries(map)
    } catch (e) {
      setError('Não foi possível carregar o odontograma.')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  const statusById = useMemo(() => {
    const m = new Map<string, DentalStatusDTO>()
    for (const s of statuses) m.set(s.id, s)
    return m
  }, [statuses])

  const { faceMarksByTooth, toothMarkByTooth } = useMemo(() => {
    const faces: Record<number, Partial<Record<Surface, FaceMark>>> = {}
    const teeth: Record<number, FaceMark | null> = {}
    for (const e of Object.values(entries)) {
      const s = statusById.get(e.statusId)
      if (!s || s.code === 'none') continue // "sem registro" não pinta
      const mark: FaceMark = { color: s.color, label: s.label, code: s.code }
      if (e.surface === null) {
        teeth[e.toothFdi] = mark
      } else {
        faces[e.toothFdi] = { ...(faces[e.toothFdi] ?? {}), [e.surface]: mark }
      }
    }
    return { faceMarksByTooth: faces, toothMarkByTooth: teeth }
  }, [entries, statusById])

  const apply = useCallback(
    async (toothFdi: number, surface: Surface | null, status: DentalStatusDTO) => {
      if (!canWrite || saving) return
      const key = posKey(toothFdi, surface)
      const prev = entries[key]
      const optimistic: CurrentEntry = {
        id: `optimistic-${key}`,
        toothFdi,
        surface,
        statusId: status.id,
        note: note.trim() || null,
        recordedAt: new Date().toISOString(),
        appointmentId: appointmentId ?? null,
      }
      setEntries((m) => ({ ...m, [key]: optimistic }))
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/pacientes/${patientId}/odontograma`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tooth_fdi: toothFdi,
            surface,
            status_id: status.id,
            note: note.trim() || null,
            appointment_id: appointmentId ?? null,
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const saved: CurrentEntry = await res.json()
        setEntries((m) => ({ ...m, [key]: saved }))
        setNote('')
      } catch (e) {
        // Reverte a marcação otimista.
        setEntries((m) => {
          const next = { ...m }
          if (prev) next[key] = prev
          else delete next[key]
          return next
        })
        setError('Falha ao salvar a marcação. Tente novamente.')
      } finally {
        setSaving(false)
      }
    },
    [appointmentId, canWrite, entries, note, patientId, saving],
  )

  const handleClickFace = useCallback(
    (toothFdi: number, surface: Surface) => {
      if (!selected) {
        setError('Selecione um status na paleta antes de marcar.')
        return
      }
      if (selected.scope === 'tooth') {
        void apply(toothFdi, null, selected)
      } else {
        // 'face' ou 'both' (limpar) aplicam à face clicada.
        void apply(toothFdi, surface, selected)
      }
    },
    [apply, selected],
  )

  const handleClickTooth = useCallback(
    (toothFdi: number) => {
      if (!selected) {
        setError('Selecione um status na paleta antes de marcar.')
        return
      }
      // O overlay de dente inteiro só aparece quando há toothMark; clicar nele
      // com um status de dente reaplica, e com "Sem registro" limpa o dente.
      if (selected.scope === 'tooth' || selected.scope === 'both') {
        void apply(toothFdi, null, selected)
      }
    },
    [apply, selected],
  )

  const handleInspect = useCallback(
    async (toothFdi: number) => {
      setHistoryTooth(toothFdi)
      setHistoryLoading(true)
      try {
        const res = await fetch(
          `/api/pacientes/${patientId}/odontograma/historico?toothFdi=${toothFdi}`,
          { headers: { accept: 'application/json' } },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: { items: HistoryEntry[] } = await res.json()
        setHistoryItems(data.items)
      } catch {
        setHistoryItems([])
      } finally {
        setHistoryLoading(false)
      }
    },
    [patientId],
  )

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando odontograma…</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-200 text-xs">
          {(['permanent', 'deciduous'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDentition(d)}
              className={cn(
                'px-3 py-1 font-medium transition',
                dentition === d
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {d === 'permanent' ? 'Permanentes' : 'Decíduos'}
            </button>
          ))}
        </div>
        {saving ? <span className="text-xs text-slate-400">Salvando…</span> : null}
      </div>

      {canWrite ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <StatusPalette
            statuses={statuses}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            disabled={saving}
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              placeholder="Observação (opcional) — aplicada na próxima marcação"
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Selecione um status e clique no dente (ou na face) para aplicar. “Sem registro” limpa a
            marcação.
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Você não tem permissão para editar o odontograma.</p>
      )}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <OdontogramChart
        dentition={dentition}
        faceMarksByTooth={faceMarksByTooth}
        toothMarkByTooth={toothMarkByTooth}
        onClickFace={handleClickFace}
        onClickTooth={handleClickTooth}
        onInspect={handleInspect}
        disabled={!canWrite || saving}
      />

      {historyTooth !== null ? (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-800">Histórico — dente {historyTooth}</h4>
            <button
              type="button"
              onClick={() => setHistoryTooth(null)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Fechar
            </button>
          </div>
          {historyLoading ? (
            <p className="text-xs text-slate-500">Carregando…</p>
          ) : historyItems.length === 0 ? (
            <p className="text-xs text-slate-500">Sem registros para este dente.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {historyItems.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-x-2 text-slate-600">
                  <span className="text-slate-400">
                    {new Date(h.recordedAt).toLocaleString('pt-BR')}
                  </span>
                  <span className="font-medium text-slate-800">{h.statusLabel ?? '—'}</span>
                  <span>{h.surface ? surfaceLabel(h.surface, historyTooth) : 'dente inteiro'}</span>
                  {h.note ? <span className="italic text-slate-500">“{h.note}”</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
