'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { addMinutes, isSameDay } from 'date-fns'
import { cn } from '@/lib/utils'
import {
  CALENDAR_HOUR_END,
  CALENDAR_HOUR_START,
  CALENDAR_SLOT_HEIGHT_REM,
  assignLanes,
  detectVisualConflicts,
  toDateTimeLocalValue,
  type WeekRange,
} from '@/lib/utils/calendar'
import type { AppointmentWeekRow } from '@/lib/core/appointments/list-week'
import { CalendarBlock } from './calendar-block'
import { CurrentTimeLine } from './current-time-line'

interface Props {
  range: WeekRange | { start: Date; end: Date; days: Date[] }
  appointments: AppointmentWeekRow[]
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const HOURS = Array.from(
  { length: CALENDAR_HOUR_END - CALENDAR_HOUR_START },
  (_, i) => CALENDAR_HOUR_START + i,
)

export function CalendarView({ range, appointments }: Props) {
  const router = useRouter()
  const today = useMemo(() => new Date(), [])

  const currentDayIndex = useMemo(() => {
    const idx = range.days.findIndex((d) => isSameDay(d, today))
    return idx >= 0 ? idx : null
  }, [range.days, today])

  // Agrupa atendimentos por dia, depois roda assign-lanes por dia.
  const blocksPerDay = useMemo(() => {
    const map = new Map<
      string,
      { id: string; start: Date; end: Date; appointment: AppointmentWeekRow }[]
    >()
    for (const a of appointments) {
      const start = new Date(a.appointmentAt)
      const end = addMinutes(start, a.durationMinutes)
      const dayKey = isoKey(start)
      const arr = map.get(dayKey) ?? []
      arr.push({ id: a.id, start, end, appointment: a })
      map.set(dayKey, arr)
    }
    return map
  }, [appointments])

  const totalHeightRem = HOURS.length * CALENDAR_SLOT_HEIGHT_REM

  function onSlotClick(day: Date, hour: number) {
    const dt = new Date(day)
    dt.setHours(hour, 0, 0, 0)
    const at = toDateTimeLocalValue(dt)
    router.push(`/operacao/atendimentos/novo?at=${encodeURIComponent(at)}`)
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `4rem repeat(${range.days.length}, minmax(7rem, 1fr))`,
        }}
      >
        {/* Header */}
        <div className="border-b border-r border-slate-200 bg-slate-50" />
        {range.days.map((d, idx) => {
          const isToday = isSameDay(d, today)
          return (
            <div
              key={`h-${idx}`}
              className={cn(
                'border-b border-l border-slate-200 px-2 py-2 text-center',
                isToday && 'bg-blue-50',
              )}
            >
              <div
                className={cn(
                  'text-[10px] font-bold uppercase tracking-widest',
                  isToday ? 'text-primary' : 'text-slate-500',
                )}
              >
                {range.days.length === 1 ? formatLongDay(d) : DAY_LABELS[d.getDay()]}
              </div>
              <div
                className={cn(
                  'mt-0.5 text-base font-black tabular-nums',
                  isToday ? 'text-primary' : 'text-slate-800',
                )}
              >
                {String(d.getDate()).padStart(2, '0')}
                {range.days.length === 1 ? null : (
                  <span className="ml-0.5 text-[10px] font-medium text-slate-400">
                    /{String(d.getMonth() + 1).padStart(2, '0')}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {/* Hour gutter + day columns */}
        <div className="relative border-r border-slate-200 bg-slate-50">
          {HOURS.map((h) => (
            <div
              key={`hr-${h}`}
              className="flex items-start justify-end border-b border-slate-100 pr-2 pt-0.5 text-[10px] font-medium text-slate-500"
              style={{ height: `${CALENDAR_SLOT_HEIGHT_REM}rem` }}
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Wrapper relativo para os blocos posicionados absolutamente. Renderiza
            como uma linha unica dentro do grid de N dias, mas cada coluna de
            dia tem seu proprio container relativo. */}
        <div
          className="relative col-span-full grid"
          style={{
            gridColumn: `2 / span ${range.days.length}`,
            gridTemplateColumns: `repeat(${range.days.length}, minmax(7rem, 1fr))`,
            height: `${totalHeightRem}rem`,
          }}
        >
          {range.days.map((d, dayIdx) => {
            const isToday = isSameDay(d, today)
            const blocks = blocksPerDay.get(isoKey(d)) ?? []
            const lanes = assignLanes(blocks)
            // US4: marca blocos conflitantes do mesmo doctor (visual fallback).
            detectVisualConflicts(lanes.visible, (b) => b.appointment.doctorId)
            return (
              <div
                key={`col-${dayIdx}`}
                className={cn(
                  'relative border-l border-slate-200',
                  isToday && 'bg-blue-50/40',
                )}
              >
                {HOURS.map((h) => (
                  <button
                    key={`slot-${dayIdx}-${h}`}
                    type="button"
                    aria-label={`Criar atendimento em ${formatShort(d)} ${h}:00`}
                    onClick={() => onSlotClick(d, h)}
                    className="block w-full border-b border-slate-100 transition-colors hover:bg-blue-100/40"
                    style={{ height: `${CALENDAR_SLOT_HEIGHT_REM}rem` }}
                  />
                ))}
                {lanes.visible.map((assignment) => (
                  <CalendarBlock
                    key={assignment.block.id}
                    assignment={assignment}
                  />
                ))}
                {lanes.overflow.length > 0 ? (
                  <div className="absolute right-1 top-1 z-20 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    +{lanes.overflow.length} mais
                  </div>
                ) : null}
              </div>
            )
          })}
          <CurrentTimeLine
            currentDayIndex={currentDayIndex}
            columnCount={range.days.length}
          />
        </div>
      </div>
    </div>
  )
}

function isoKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatShort(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatLongDay(d: Date): string {
  const long = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  return long[d.getDay()] ?? ''
}
