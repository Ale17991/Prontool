'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { addMonths, addWeeks, parseISO } from 'date-fns'
import {
  deriveRange,
  filtersToParams,
  isoFromDate,
  parseFilters,
  todayIso,
  type CalendarFilters,
} from './calendar-filters'

// Re-export types e helpers PUROS para back-compat com callers existentes.
// As helpers vivem em ./calendar-filters (módulo server-safe sem 'use client').
// Server components devem importar diretamente do módulo puro — re-exportar
// daqui mantém callers client funcionando sem fricção.
export type {
  CalendarFilters,
  CalendarStatus,
  CalendarView,
} from './calendar-filters'

export interface UseCalendarFiltersResult {
  filters: CalendarFilters
  range: { from: Date; to: Date }
  setFilter: <K extends keyof CalendarFilters>(
    key: K,
    value: CalendarFilters[K] | null,
  ) => void
  /**
   * Batch update — necessário para atalhos que precisam mudar view+date
   * atomicamente. Chamar setFilter duas vezes em sequência perde a primeira
   * mudança (closure de `filters` ainda tem o valor anterior).
   */
  setFilters: (patch: Partial<CalendarFilters>) => void
  setRange: (from: Date, to: Date) => void
  shiftView: (delta: -1 | 1) => void
  clear: () => void
  asQuery: () => string
}

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
      if ((key === 'view' || key === 'date') && (filters.from || filters.to)) {
        next.from = null
        next.to = null
      }
      writeFilters(next)
    },
    [filters, writeFilters],
  )

  const setFilters = useCallback(
    (patch: Partial<CalendarFilters>) => {
      const next: CalendarFilters = { ...filters, ...patch }
      if (
        ('view' in patch || 'date' in patch) &&
        (filters.from || filters.to) &&
        !('from' in patch) &&
        !('to' in patch)
      ) {
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

  return { filters, range, setFilter, setFilters, setRange, shiftView, clear, asQuery }
}

// Exports para o teste unitário continuarem batendo o __testing prévio.
// Tests rodam fora do runtime do Next, então 'use client' aqui é irrelevante.
export const __testing = { parseFilters, filtersToParams, deriveRange, todayIso }
