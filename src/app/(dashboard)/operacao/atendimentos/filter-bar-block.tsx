'use client'

import { useCalendarFilters } from './use-calendar-filters'
import { FilterBar } from './filter-bar'
import type { DoctorFilterOption } from './calendar/doctor-filter'

/**
 * Wrapper que liga o hook de filtros URL-state ao FilterBar visual.
 * Usado pelo modo Lista (cal mode usa o FilterBar via CalendarShell).
 */
export function FilterBarBlock({ doctors }: { doctors: DoctorFilterOption[] }) {
  const { filters, setFilter, setFilters, clear } = useCalendarFilters()
  return (
    <FilterBar
      filters={filters}
      doctors={doctors}
      onChangeFilter={setFilter}
      onChangeFilters={setFilters}
      onClear={clear}
    />
  )
}
