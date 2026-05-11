'use client'

import { useMemo } from 'react'
import { addMonths, eachDayOfInterval, format, parseISO } from 'date-fns'
import { useCalendarFilters } from './use-calendar-filters'
import { MiniCalendar } from './mini-calendar'
import { FilterBar } from './filter-bar'
import { MonthView, type MonthViewAppointment } from './views/month-view'
import { CalendarView } from './calendar/calendar-view'
import type { AppointmentWeekRow } from '@/lib/core/appointments/list-week'
import type { DoctorFilterOption } from './calendar/doctor-filter'

/**
 * Feature 010 (US4 / T050+T051) — orquestrador do modo Calendário.
 *
 * Cola os building blocks (MiniCalendar, FilterBar, CalendarView, MonthView)
 * com o hook useCalendarFilters como single source of truth.
 *
 * Filtros server-side: o `page.tsx` aplica range (from/to) e doctor antes
 * de chamar list-week. Demais filtros (status, procedure, patient) são
 * client-side aqui — patient está encrypted no banco, status mapeia 3
 * valores UI para o effectiveStatus computado por list-week, procedure
 * poderia ser server mas é uniforme manter aqui.
 */

interface Props {
  appointments: AppointmentWeekRow[]
  doctors: DoctorFilterOption[]
}

// UI status → effectiveStatus do AppointmentWeekRow (list-week consolida
// agendado/ativo/estornado a partir do timestamp + effective_status do DB).
const UI_TO_EFFECTIVE_STATUS: Record<string, AppointmentWeekRow['effectiveStatus']> = {
  agendado: 'agendado',
  realizado: 'ativo',
  cancelado: 'estornado',
}

export function CalendarShell({ appointments, doctors }: Props) {
  const { filters, range, setFilter, setFilters, clear } = useCalendarFilters()

  const filtered = useMemo(() => {
    return appointments.filter((a) => {
      if (filters.status) {
        const effective = UI_TO_EFFECTIVE_STATUS[filters.status]
        if (a.effectiveStatus !== effective) return false
      }
      if (filters.procedure) {
        const proc = (a.procedureLabel ?? '').toLowerCase()
        if (!proc.includes(filters.procedure.toLowerCase())) return false
      }
      if (filters.patient) {
        const pat = (a.patientName ?? '').toLowerCase()
        if (!pat.includes(filters.patient.toLowerCase())) return false
      }
      return true
    })
  }, [appointments, filters.status, filters.procedure, filters.patient])

  // Pontos do mini calendário marcam dias com QUALQUER appointment do
  // tenant (não filtrado por procedure/patient — o ponto representa
  // "tem agenda nesse dia", não "tem agenda que casa com filtro").
  const hasAppointmentsByDay = useMemo(() => {
    const set = new Set<string>()
    for (const a of appointments) {
      set.add(a.appointmentAt.slice(0, 10))
    }
    return set
  }, [appointments])

  const selectedDate = useMemo(() => parseISO(filters.date), [filters.date])

  const monthAppts: MonthViewAppointment[] = useMemo(
    () =>
      filtered.map((a) => ({
        id: a.id,
        appointmentAt: a.appointmentAt,
        effectiveStatus: a.effectiveStatus,
        patientLabel: a.patientName,
        procedureLabel: a.procedureLabel,
        doctorLabel: a.doctorName,
      })),
    [filtered],
  )

  // CalendarView (dia/semana) espera { start, end, days[] }. Para view='mes'
  // usamos MonthView que recebe só date+appointments.
  const calRange = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to })
    return { start: range.from, end: range.to, days }
  }, [range.from, range.to])

  function handleMiniSelect(d: Date) {
    setFilter('date', format(d, 'yyyy-MM-dd'))
  }

  /**
   * Navega o mini calendário em meses (independente do view atual).
   * O hook.shiftView shifta por view (week/month) — não serve aqui:
   * em view='semana' o usuário clicando "próximo mês" no mini esperaria
   * avançar 1 mês, não 1 semana.
   */
  function handleMiniNavigateMonth(delta: -1 | 1) {
    const next = addMonths(selectedDate, delta)
    setFilter('date', format(next, 'yyyy-MM-dd'))
  }

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        doctors={doctors}
        onChangeFilter={setFilter}
        onChangeFilters={setFilters}
        onClear={clear}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
        <div>
          <MiniCalendar
            value={selectedDate}
            hasAppointmentsByDay={hasAppointmentsByDay}
            onSelect={handleMiniSelect}
            onNavigateMonth={handleMiniNavigateMonth}
          />
        </div>
        <div>
          {filters.view === 'mes' ? (
            <MonthView date={selectedDate} appointments={monthAppts} />
          ) : (
            <CalendarView range={calRange} appointments={filtered} />
          )}
        </div>
      </div>
    </div>
  )
}
