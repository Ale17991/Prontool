'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ProcedureOption {
  procedureId: string
  displayName: string
  durationMinutes: number
}

interface SlotPickerProps {
  slug: string
  doctorId: string
  procedures: ProcedureOption[]
  minHoursAdvance: number
  maxDaysAdvance: number
  initialProcedureId: string | null
}

interface Slot {
  start: string
  end: string
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatBrasilia(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatBrasiliaDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: 'long',
  }).format(new Date(iso))
}

export function SlotPicker({
  slug,
  doctorId,
  procedures,
  maxDaysAdvance,
  initialProcedureId,
}: SlotPickerProps) {
  const firstProcId = procedures[0]?.procedureId ?? null
  const [procedureId, setProcedureId] = useState<string | null>(
    initialProcedureId ?? firstProcId,
  )
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const fromDate = useMemo(() => toISODate(new Date()), [])
  const toDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + maxDaysAdvance)
    return toISODate(d)
  }, [maxDaysAdvance])

  useEffect(() => {
    if (!procedureId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const url = new URL(
          `/api/public/booking/${slug}/slots`,
          window.location.origin,
        )
        url.searchParams.set('doctor_id', doctorId)
        url.searchParams.set('procedure_id', procedureId!)
        url.searchParams.set('from', fromDate)
        url.searchParams.set('to', toDate)
        const res = await fetch(url.toString(), { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const json = (await res.json()) as { slots: Slot[] }
        if (!cancelled) setSlots(json.slots)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Erro ao buscar horários.')
          setSlots([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [slug, doctorId, procedureId, fromDate, toDate])

  const slotsByDay = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of slots) {
      const localDate = formatBrasiliaDate(s.start)
      const arr = map.get(localDate) ?? []
      arr.push(s)
      map.set(localDate, arr)
    }
    return Array.from(map.entries())
  }, [slots])

  function chooseSlot(slot: Slot) {
    const params = new URLSearchParams()
    params.set('doctor_id', doctorId)
    params.set('procedure_id', procedureId ?? '')
    params.set('slot_start', slot.start)
    router.push(`/agendar/${slug}/confirmar?${params.toString()}`)
  }

  if (!procedureId) return null

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">
          Procedimento
        </label>
        <select
          value={procedureId}
          onChange={(e) => setProcedureId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {procedures.map((p) => (
            <option key={p.procedureId} value={p.procedureId}>
              {p.displayName} ({p.durationMinutes} min)
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          Horários disponíveis
        </h2>
        {loading && (
          <p className="text-sm text-slate-500">Buscando horários...</p>
        )}
        {error && (
          <p className="text-sm text-destructive">Erro: {error}</p>
        )}
        {!loading && !error && slotsByDay.length === 0 && (
          <p className="text-sm text-slate-500">
            Não há horários disponíveis para este procedimento. Tente outro
            profissional ou entre em contato com a clínica.
          </p>
        )}
        <div className="space-y-4">
          {slotsByDay.map(([dayLabel, daySlots]) => (
            <div key={dayLabel}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {dayLabel}
              </h3>
              <div className="flex flex-wrap gap-2">
                {daySlots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => chooseSlot(s)}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-slate-800 transition hover:border-primary hover:bg-primary hover:text-primary-foreground"
                  >
                    {formatBrasilia(s.start)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
