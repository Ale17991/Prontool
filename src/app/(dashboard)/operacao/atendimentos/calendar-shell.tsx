'use client'

import { useMemo } from 'react'
import { eachDayOfInterval, parseISO } from 'date-fns'
import { useCalendarFilters } from './use-calendar-filters'
import { FilterBar } from './filter-bar'
import { MonthView, type MonthViewAppointment } from './views/month-view'
import { CalendarView } from './calendar/calendar-view'
import type { AppointmentWeekRow } from '@/lib/core/appointments/list-week'
import type { ScheduleBlockRow } from '@/lib/core/schedule-blocks/types'
import type { DoctorFilterOption } from './calendar/doctor-filter'

/**
 * Feature 010 (US4 / T050+T051) — orquestrador do modo Calendário.
 *
 * Cola os building blocks (FilterBar, CalendarView, MonthView) com o hook
 * useCalendarFilters como single source of truth.
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
  scheduleBlocks?: ScheduleBlockRow[]
  canManageBlocks?: boolean
  /** Período (minutos) que cada linha da agenda representa. */
  intervalMinutes?: number
  /** Janela de funcionamento (minutos desde a meia-noite). */
  dayStartMinute?: number
  dayEndMinute?: number
}

// UI status → predicado sobre o effectiveStatus do AppointmentWeekRow.
// "cancelado" abrange tanto cancelado (desmarcado) quanto estornado (financeiro).
function matchesUiStatus(effective: AppointmentWeekRow['effectiveStatus'], ui: string): boolean {
  if (ui === 'realizado') return effective === 'ativo'
  if (ui === 'agendado') return effective === 'agendado'
  if (ui === 'cancelado') return effective === 'cancelado' || effective === 'estornado'
  return true
}

export function CalendarShell({
  appointments,
  doctors,
  scheduleBlocks = [],
  canManageBlocks = false,
  intervalMinutes,
  dayStartMinute,
  dayEndMinute,
}: Props) {
  const { filters, range, setFilter, setFilters, clear } = useCalendarFilters()

  const filtered = useMemo(() => {
    return appointments.filter((a) => {
      // Estornados só aparecem quando o usuário escolhe explicitamente
      // status=cancelado. Sem filtro de status, escondemos para evitar
      // que um atendimento estornado pareça conflitar com um novo agendado
      // no mesmo horário (o slot já foi liberado no banco).
      if (filters.status) {
        if (!matchesUiStatus(a.effectiveStatus, filters.status)) return false
      } else if (a.effectiveStatus === 'estornado' || a.effectiveStatus === 'cancelado') {
        // Sem filtro explícito, esconde os terminais (vaga liberada) para não
        // parecer que ainda ocupam o horário.
        return false
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

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        doctors={doctors}
        onChangeFilter={setFilter}
        onChangeFilters={setFilters}
        onClear={clear}
      />
      {filters.view === 'mes' ? (
        <MonthView date={selectedDate} appointments={monthAppts} />
      ) : (
        <CalendarView
          range={calRange}
          appointments={filtered}
          scheduleBlocks={scheduleBlocks}
          canManageBlocks={canManageBlocks}
          intervalMinutes={intervalMinutes}
          dayStartMinute={dayStartMinute}
          dayEndMinute={dayEndMinute}
        />
      )}
    </div>
  )
}
