'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ptBR } from 'date-fns/locale/pt-BR'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

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

const TZ = 'America/Sao_Paulo'

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Bucket que o backend usa pra cada slot, derivado da hora-de-Brasília (não
 * da hora local do browser). Sem isso, um paciente que abre a página de
 * outro fuso vê os slots em buckets errados.
 */
function brasiliaDateKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function formatHourMinute(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatLongDate(d: Date): string {
  return format(d, "EEEE, d 'de' MMMM", { locale: ptBR })
}

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const

export function SlotPicker({
  slug,
  doctorId,
  procedures,
  maxDaysAdvance,
  initialProcedureId,
}: SlotPickerProps) {
  const firstProcId = procedures[0]?.procedureId ?? null
  const [procedureId, setProcedureId] = useState<string | null>(initialProcedureId ?? firstProcId)

  const today = useMemo(() => startOfDay(new Date()), [])
  const maxDate = useMemo(() => startOfDay(addDays(today, maxDaysAdvance)), [today, maxDaysAdvance])

  const [visibleMonth, setVisibleMonth] = useState<Date>(startOfMonth(today))
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const router = useRouter()

  // Range do fetch = clamp do mes visivel dentro de [today, maxDate].
  const fetchRange = useMemo(() => {
    const monthStart = startOfMonth(visibleMonth)
    const monthEnd = endOfMonth(visibleMonth)
    const from = isBefore(monthStart, today) ? today : monthStart
    const to = isAfter(monthEnd, maxDate) ? maxDate : monthEnd
    if (isAfter(from, to)) {
      return null // mes inteiro fora da janela permitida
    }
    return { from: toISODate(from), to: toISODate(to) }
  }, [visibleMonth, today, maxDate])

  useEffect(() => {
    if (!procedureId) return
    if (!fetchRange) {
      setSlots([])
      return
    }
    let cancelled = false
    async function load(range: { from: string; to: string }) {
      setLoading(true)
      setError(null)
      try {
        const url = new URL(`/api/public/booking/${slug}/slots`, window.location.origin)
        url.searchParams.set('doctor_id', doctorId)
        url.searchParams.set('procedure_id', procedureId!)
        url.searchParams.set('from', range.from)
        url.searchParams.set('to', range.to)
        const res = await fetch(url.toString(), { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
    void load(fetchRange)
    return () => {
      cancelled = true
    }
  }, [slug, doctorId, procedureId, fetchRange])

  // Map<dateKey YYYY-MM-DD em America/Sao_Paulo, Slot[]>.
  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of slots) {
      const key = brasiliaDateKey(s.start)
      const arr = map.get(key) ?? []
      arr.push(s)
      map.set(key, arr)
    }
    return map
  }, [slots])

  // Quando o procedure muda ou o mes muda, limpa o dia selecionado se nao
  // tiver mais slots disponiveis nele.
  useEffect(() => {
    if (!selectedDate) return
    const key = toISODate(selectedDate)
    if (!slotsByDate.has(key)) {
      setSelectedDate(null)
    }
  }, [slotsByDate, selectedDate])

  function gotoMonth(delta: 1 | -1) {
    setSelectedDate(null)
    setVisibleMonth((m) => addMonths(m, delta))
  }

  const canGoPrev = !isSameMonth(visibleMonth, today) && isAfter(visibleMonth, today)
  const canGoNext = isBefore(endOfMonth(visibleMonth), maxDate)

  // Grade do mes: linhas comecando no domingo, ate cobrir o mes inteiro.
  const monthGrid = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 0 })
    const days: Date[] = []
    let cursor = gridStart
    for (let i = 0; i < 42; i++) {
      days.push(cursor)
      cursor = addDays(cursor, 1)
    }
    return days
  }, [visibleMonth])

  const selectedSlots = useMemo(() => {
    if (!selectedDate) return []
    return slotsByDate.get(toISODate(selectedDate)) ?? []
  }, [selectedDate, slotsByDate])

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
      {/* Procedimento */}
      <div className="rounded-lg border border-border bg-card p-4">
        <label htmlFor="procedure-select" className="block text-sm font-medium text-slate-700">
          Procedimento
        </label>
        <select
          id="procedure-select"
          value={procedureId}
          onChange={(e) => {
            setProcedureId(e.target.value)
            setSelectedDate(null)
          }}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {procedures.map((p) => (
            <option key={p.procedureId} value={p.procedureId}>
              {p.displayName} ({p.durationMinutes} min)
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Calendário */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => gotoMonth(-1)}
              disabled={!canGoPrev}
              aria-label="Mês anterior"
              className="rounded-md p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-sm font-semibold capitalize text-slate-900">
              {format(visibleMonth, "MMMM 'de' yyyy", { locale: ptBR })}
            </h2>
            <button
              type="button"
              onClick={() => gotoMonth(1)}
              disabled={!canGoNext}
              aria-label="Próximo mês"
              className="rounded-md p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((label, i) => (
              <div
                key={i}
                className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                {label}
              </div>
            ))}
            {monthGrid.map((day) => {
              const inMonth = isSameMonth(day, visibleMonth)
              const inWindow = !isBefore(day, today) && !isAfter(day, maxDate)
              const dateKey = toISODate(day)
              const hasSlots = slotsByDate.has(dateKey)
              const isSelected = selectedDate !== null && isSameDay(day, selectedDate)
              const isToday = isSameDay(day, today)
              const clickable = inMonth && inWindow && hasSlots

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => clickable && setSelectedDate(day)}
                  disabled={!clickable}
                  aria-label={format(day, "d 'de' MMMM 'de' yyyy", {
                    locale: ptBR,
                  })}
                  aria-pressed={isSelected}
                  className={cn(
                    'relative h-9 rounded-md text-sm font-medium transition',
                    !inMonth && 'text-slate-300',
                    inMonth && !clickable && 'text-slate-400',
                    clickable && !isSelected && 'text-slate-900 hover:bg-slate-100',
                    isSelected && 'bg-primary text-primary-foreground shadow-sm',
                    isToday && !isSelected && 'ring-1 ring-primary/30',
                  )}
                >
                  {format(day, 'd')}
                  {clickable && !isSelected ? (
                    <span
                      aria-hidden
                      className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
                    />
                  ) : null}
                </button>
              )
            })}
          </div>

          {loading ? (
            <p className="mt-3 text-center text-xs text-slate-500">Carregando disponibilidade…</p>
          ) : null}
          {error ? (
            <p className="mt-3 text-center text-xs text-destructive">Erro ao carregar: {error}</p>
          ) : null}
          {!loading && !error && slotsByDate.size === 0 ? (
            <p className="mt-3 text-center text-xs text-slate-500">
              Nenhum horário disponível neste mês.
            </p>
          ) : null}
        </div>

        {/* Horários do dia */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            {selectedDate ? (
              <span className="capitalize">{formatLongDate(selectedDate)}</span>
            ) : (
              'Escolha um dia'
            )}
          </h2>

          {!selectedDate ? (
            <p className="text-xs text-slate-500">
              Selecione uma data no calendário para ver os horários disponíveis.
            </p>
          ) : selectedSlots.length === 0 ? (
            <p className="text-xs text-slate-500">Sem horários disponíveis nesta data.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 md:grid-cols-3">
              {selectedSlots.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => chooseSlot(s)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-primary hover:bg-primary hover:text-primary-foreground"
                >
                  {formatHourMinute(s.start)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
