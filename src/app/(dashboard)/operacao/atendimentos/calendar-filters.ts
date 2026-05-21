/**
 * Feature 010 (US4 / R11) — helpers PUROS do schema de filtros do calendário.
 *
 * Server-safe: este módulo NÃO tem `'use client'` e pode ser importado por
 * server components (page.tsx) sem virar client reference object. O hook
 * `useCalendarFilters` em `./use-calendar-filters.ts` (client-only) reusa
 * essas funções via import.
 *
 * Schema da URL (todos opcionais; defaults derivados de view+date):
 *   ?view=dia|semana|mes
 *   ?date=YYYY-MM-DD
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (sobrepõe view-derived)
 *   ?doctor=<UUID>
 *   ?status=agendado|realizado|cancelado
 *   ?procedure=<substring ≤60>
 *   ?patient=<substring ≤60>
 */

import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

export type CalendarView = 'dia' | 'semana' | 'mes'
export type CalendarStatus = 'agendado' | 'realizado' | 'cancelado'

export interface CalendarFilters {
  view: CalendarView
  date: string
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

export function todayIso(): string {
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

function trimToMax(input: string | null, max: number): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

export function parseFilters(searchParams: URLSearchParams): CalendarFilters {
  const rawView = searchParams.get('view')
  const view: CalendarView =
    rawView && VIEW_VALUES.has(rawView as CalendarView)
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

export function parseFiltersFromRecord(
  searchParams: Record<string, string | string[] | undefined>,
): CalendarFilters {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') params.set(k, v)
    else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') {
      params.set(k, v[0])
    }
  }
  return parseFilters(params)
}

export function deriveRange(filters: CalendarFilters): { from: Date; to: Date } {
  // Custom range tem precedencia. parseISO de "YYYY-MM-DD" volta a meia-noite
  // LOCAL — sem startOfDay/endOfDay o `to` ficaria no comeco do dia escolhido
  // e o `lte` da query DROPARIA todos os atendimentos daquele dia inteiro.
  // (Esse era o bug "ultimo dia do periodo aparece vazio".)
  if (filters.from && filters.to) {
    return {
      from: startOfDay(parseISO(filters.from)),
      to: endOfDay(parseISO(filters.to)),
    }
  }
  const date = parseISO(filters.date)
  switch (filters.view) {
    case 'dia':
      return { from: startOfDay(date), to: endOfDay(date) }
    case 'mes': {
      const monthStart = startOfMonth(date)
      const monthEnd = endOfMonth(date)
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

export function filtersToParams(filters: CalendarFilters): URLSearchParams {
  const params = new URLSearchParams()
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

export function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
