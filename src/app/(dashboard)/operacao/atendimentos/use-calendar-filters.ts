'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

/**
 * Feature 010 (US4 / R11) — single source of truth dos filtros do calendário
 * via URL query string. URL é a fonte; o componente lê com useSearchParams
 * e escreve com router.replace (sem navegação, só atualiza URL).
 *
 * Schema (todos opcionais; defaults derivados de view+date):
 *   ?view=dia|semana|mes
 *   ?date=YYYY-MM-DD
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (sobrepõe view-derived)
 *   ?doctor=<UUID>
 *   ?status=agendado|realizado|cancelado
 *   ?procedure=<substring ≤60>
 *   ?patient=<substring ≤60>
 */

export type CalendarView = 'dia' | 'semana' | 'mes'
export type CalendarStatus = 'agendado' | 'realizado' | 'cancelado'

export interface CalendarFilters {
  view: CalendarView
  date: string // YYYY-MM-DD
  from: string | null
  to: string | null
  doctor: string | null
  status: CalendarStatus | null
  procedure: string | null
  patient: string | null
}

const VIEW_VALUES: ReadonlySet<CalendarView> = new Set(['dia', 'semana', 'mes'])
const STATUS_VALUES: ReadonlySet<CalendarStatus> = new Set([
  'agendado',
  'realizado',
  'cancelado',
])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isoDateOrNull(input: string | null | undefined): string | null {
  if (!input) return null
  if (!ISO_DATE_RE.test(input)) return null
  return input
}

function parseFilters(searchParams: URLSearchParams): CalendarFilters {
  const rawView = searchParams.get('view')
  const view: CalendarView = rawView && VIEW_VALUES.has(rawView as CalendarView)
    ? (rawView as CalendarView)
    : 'semana'

  const date = isoDateOrNull(searchParams.get('date')) ?? todayIso()
  const from = isoDateOrNull(searchParams.get('from'))
  const to = isoDateOrNull(searchParams.get('to'))

  const doctorRaw = searchParams.get('doctor')
  const doctor = doctorRaw && UUID_RE.test(doctorRaw) ? doctorRaw : null

  const statusRaw = searchParams.get('status')
  const status =
    statusRaw && STATUS_VALUES.has(statusRaw as CalendarStatus)
      ? (statusRaw as CalendarStatus)
      : null

  const procedure = trimToMax(searchParams.get('procedure'), 60)
  const patient = trimToMax(searchParams.get('patient'), 60)

  return { view, date, from, to, doctor, status, procedure, patient }
}

function trimToMax(input: string | null, max: number): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

function deriveRange(filters: CalendarFilters): { from: Date; to: Date } {
  if (filters.from && filters.to) {
    return { from: parseISO(filters.from), to: parseISO(filters.to) }
  }
  const date = parseISO(filters.date)
  switch (filters.view) {
    case 'dia':
      return { from: date, to: date }
    case 'mes': {
      const monthStart = startOfMonth(date)
      const monthEnd = endOfMonth(date)
      // Mês visível inclui semana parcial inicial e final.
      return {
        from: startOfWeek(monthStart, { weekStartsOn: 0 }),
        to: endOfWeek(monthEnd, { weekStartsOn: 0 }),
      }
    }
    case 'semana':
    default:
      return {
        from: startOfWeek(date, { weekStartsOn: 0 }),
        to: endOfWeek(date, { weekStartsOn: 0 }),
      }
  }
}

function filtersToParams(filters: CalendarFilters): URLSearchParams {
  const params = new URLSearchParams()
  // Default omissivel: view=semana e date=hoje quando não há filtros extras.
  const isFullDefault =
    filters.view === 'semana' &&
    filters.date === todayIso() &&
    filters.from === null &&
    filters.to === null &&
    filters.doctor === null &&
    filters.status === null &&
    filters.procedure === null &&
    filters.patient === null
  if (isFullDefault) return params

  if (filters.view !== 'semana') params.set('view', filters.view)
  if (filters.date !== todayIso()) params.set('date', filters.date)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.doctor) params.set('doctor', filters.doctor)
  if (filters.status) params.set('status', filters.status)
  if (filters.procedure) params.set('procedure', filters.procedure)
  if (filters.patient) params.set('patient', filters.patient)
  return params
}

export interface UseCalendarFiltersResult {
  filters: CalendarFilters
  range: { from: Date; to: Date }
  setFilter: <K extends keyof CalendarFilters>(
    key: K,
    value: CalendarFilters[K] | null,
  ) => void
  setRange: (from: Date, to: Date) => void
  shiftView: (delta: -1 | 1) => void
  clear: () => void
  asQuery: () => string
}

/**
 * Hook principal — testável via parseFilters/filtersToParams (round-trip).
 */
export function useCalendarFilters(): UseCalendarFiltersResult {
  const router = useRouter()
  const pathname = usePathname() ?? '/operacao/atendimentos'
  const searchParams = useSearchParams()

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams?.toString() ?? '')),
    [searchParams],
  )
  const range = useMemo(() => deriveRange(filters), [filters])

  const writeFilters = useCallback(
    (next: CalendarFilters) => {
      const params = filtersToParams(next)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router],
  )

  const setFilter = useCallback(
    <K extends keyof CalendarFilters>(key: K, value: CalendarFilters[K] | null) => {
      const next: CalendarFilters = { ...filters, [key]: value as CalendarFilters[K] }
      // Trocar view/date invalida o range custom — só limpa se realmente mudou.
      if ((key === 'view' || key === 'date') && (filters.from || filters.to)) {
        next.from = null
        next.to = null
      }
      writeFilters(next)
    },
    [filters, writeFilters],
  )

  const setRange = useCallback(
    (from: Date, to: Date) => {
      writeFilters({
        ...filters,
        from: isoFromDate(from),
        to: isoFromDate(to),
      })
    },
    [filters, writeFilters],
  )

  const shiftView = useCallback(
    (delta: -1 | 1) => {
      const date = parseISO(filters.date)
      const next = filters.view === 'mes' ? addMonths(date, delta) : addWeeks(date, delta)
      writeFilters({ ...filters, date: isoFromDate(next), from: null, to: null })
    },
    [filters, writeFilters],
  )

  const clear = useCallback(() => {
    router.replace(pathname, { scroll: false })
  }, [pathname, router])

  const asQuery = useCallback(() => filtersToParams(filters).toString(), [filters])

  return { filters, range, setFilter, setRange, shiftView, clear, asQuery }
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Exports públicos para testes — round-trip URL ↔ filters.
export const __testing = { parseFilters, filtersToParams, deriveRange, todayIso }
