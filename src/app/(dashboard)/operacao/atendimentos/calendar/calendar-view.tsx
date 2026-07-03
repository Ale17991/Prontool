'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addMinutes, isSameDay } from 'date-fns'
import { Lock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CALENDAR_SLOT_HEIGHT_REM,
  DEFAULT_DAY_END_MINUTE,
  DEFAULT_DAY_START_MINUTE,
  DEFAULT_SLOT_INTERVAL_MINUTES,
  assignLanes,
  buildCalendarSlots,
  detectVisualConflicts,
  slotForAppointment,
  toDateTimeLocalValue,
  type WeekRange,
} from '@/lib/utils/calendar'
import type { AppointmentWeekRow } from '@/lib/core/appointments/list-week'
import type { ScheduleBlockRow } from '@/lib/core/schedule-blocks/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CalendarBlock } from './calendar-block'
import { CurrentTimeLine } from './current-time-line'

interface Props {
  range: WeekRange | { start: Date; end: Date; days: Date[] }
  appointments: AppointmentWeekRow[]
  scheduleBlocks?: ScheduleBlockRow[]
  canManageBlocks?: boolean
  /** Período (minutos) que cada linha representa. Default 60 = grade horária. */
  intervalMinutes?: number
  /** Janela de funcionamento (minutos desde a meia-noite). Default 07:00–22:00. */
  dayStartMinute?: number
  dayEndMinute?: number
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function CalendarView({
  range,
  appointments,
  scheduleBlocks = [],
  canManageBlocks = false,
  intervalMinutes = DEFAULT_SLOT_INTERVAL_MINUTES,
  dayStartMinute = DEFAULT_DAY_START_MINUTE,
  dayEndMinute = DEFAULT_DAY_END_MINUTE,
}: Props) {
  // Linhas da grade para o intervalo + janela configurados. Cada linha mantém a
  // altura (CALENDAR_SLOT_HEIGHT_REM) e cobre `intervalMinutes`.
  const slots = useMemo(
    () => buildCalendarSlots(intervalMinutes, dayStartMinute, dayEndMinute),
    [intervalMinutes, dayStartMinute, dayEndMinute],
  )
  const router = useRouter()
  const today = useMemo(() => new Date(), [])
  const [cancellingId, startCancelTransition] = useTransition()
  const [cancellingBlockId, setCancellingBlockId] = useState<string | null>(null)

  // Agrupa bloqueios por dia. Separa all_day (faixa no topo) dos demais
  // (blocos posicionados no horario).
  const blocksByDay = useMemo(() => {
    const allDayMap = new Map<string, ScheduleBlockRow[]>()
    const timedMap = new Map<string, ScheduleBlockRow[]>()
    for (const b of scheduleBlocks) {
      const key = b.blockDate
      if (b.allDay) {
        const arr = allDayMap.get(key) ?? []
        arr.push(b)
        allDayMap.set(key, arr)
      } else {
        const arr = timedMap.get(key) ?? []
        arr.push(b)
        timedMap.set(key, arr)
      }
    }
    return { allDayMap, timedMap }
  }, [scheduleBlocks])

  function cancelBlock(blockId: string) {
    if (!canManageBlocks) return
    if (!confirm('Cancelar este bloqueio de agenda?')) return
    setCancellingBlockId(blockId)
    startCancelTransition(async () => {
      try {
        const res = await fetch(`/api/agenda/bloqueios/${blockId}`, { method: 'DELETE' })
        if (res.ok) router.refresh()
      } finally {
        setCancellingBlockId(null)
      }
    })
  }

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

  const totalHeightRem = slots.length * CALENDAR_SLOT_HEIGHT_REM

  function onSlotClick(day: Date, offsetMinutes: number) {
    const dt = new Date(day)
    dt.setHours(0, 0, 0, 0)
    dt.setMinutes(dayStartMinute + offsetMinutes)
    const at = toDateTimeLocalValue(dt)
    router.push(`/operacao/atendimentos/novo?at=${encodeURIComponent(at)}`)
  }

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={50}>
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
            {slots.map((slot) => (
              <div
                key={`hr-${slot.offsetMinutes}`}
                className="flex items-start justify-end border-b border-slate-100 pr-2 pt-0.5 text-[10px] font-medium text-slate-500"
                style={{ height: `${CALENDAR_SLOT_HEIGHT_REM}rem` }}
              >
                {slot.label}
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
              const dayKey = isoKey(d)
              const blocks = blocksPerDay.get(dayKey) ?? []
              const lanes = assignLanes(blocks)
              // US4: marca blocos conflitantes do mesmo doctor (visual fallback).
              detectVisualConflicts(lanes.visible, (b) => b.appointment.doctorId)

              const dayAllDayBlocks = blocksByDay.allDayMap.get(dayKey) ?? []
              const dayTimedBlocks = blocksByDay.timedMap.get(dayKey) ?? []

              // Marca atendimentos cujo doctor tem bloqueio sobreposto neste
              // mesmo dia. Visual amarelo, nao hard-block.
              const overlappingApptIds = new Set<string>()
              for (const a of lanes.visible) {
                const apptStart = a.block.start.getTime()
                const apptEnd = a.block.end.getTime()
                for (const sb of dayTimedBlocks) {
                  if (sb.doctorId !== a.block.appointment.doctorId) continue
                  const blkStart = new Date(`${dayKey}T${sb.startTime}:00`).getTime()
                  const blkEnd = new Date(`${dayKey}T${sb.endTime}:00`).getTime()
                  if (apptStart < blkEnd && apptEnd > blkStart) {
                    overlappingApptIds.add(a.block.id)
                    break
                  }
                }
                for (const sb of dayAllDayBlocks) {
                  if (sb.doctorId === a.block.appointment.doctorId) {
                    overlappingApptIds.add(a.block.id)
                    break
                  }
                }
              }

              return (
                <div
                  key={`col-${dayIdx}`}
                  className={cn('relative border-l border-slate-200', isToday && 'bg-blue-50/40')}
                >
                  {/* Faixa de bloqueios "dia inteiro" no topo da coluna */}
                  {dayAllDayBlocks.length > 0 ? (
                    <div className="absolute left-0.5 right-0.5 top-0.5 z-20 flex flex-col gap-0.5">
                      {dayAllDayBlocks.map((sb) => (
                        <button
                          key={sb.id}
                          type="button"
                          onClick={() => canManageBlocks && cancelBlock(sb.id)}
                          title={`${sb.reason} — ${sb.doctorName ?? ''} (dia inteiro)${canManageBlocks ? ' — clique para cancelar' : ''}`}
                          className={cn(
                            'flex items-center gap-1 rounded border border-slate-400 bg-slate-700/80 px-1.5 py-0.5 text-[10px] font-bold text-white',
                            canManageBlocks && 'cursor-pointer hover:bg-slate-900',
                            !canManageBlocks && 'cursor-default',
                          )}
                        >
                          {cancellingBlockId === sb.id && cancellingId ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <Lock className="h-2.5 w-2.5" />
                          )}
                          <span className="truncate">{sb.reason}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {slots.map((slot) => (
                    <button
                      key={`slot-${dayIdx}-${slot.offsetMinutes}`}
                      type="button"
                      aria-label={`Criar atendimento em ${formatShort(d)} ${slot.label}`}
                      onClick={() => onSlotClick(d, slot.offsetMinutes)}
                      className="block w-full border-b border-slate-100 transition-colors hover:bg-blue-100/40"
                      style={{ height: `${CALENDAR_SLOT_HEIGHT_REM}rem` }}
                    />
                  ))}

                  {/* Bloqueios com horario especifico */}
                  {dayTimedBlocks.map((sb) => {
                    const startStr = sb.startTime ?? '00:00'
                    const endStr = sb.endTime ?? '00:00'
                    const [sh, sm] = startStr.split(':').map((s) => parseInt(s, 10))
                    const [eh, em] = endStr.split(':').map((s) => parseInt(s, 10))
                    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null
                    const blockStart = new Date(d)
                    blockStart.setHours(sh!, sm!, 0, 0)
                    const blockEnd = new Date(d)
                    blockEnd.setHours(eh!, em!, 0, 0)
                    const durMin = Math.max(
                      5,
                      Math.round((blockEnd.getTime() - blockStart.getTime()) / 60_000),
                    )
                    const pos = slotForAppointment(
                      blockStart,
                      durMin,
                      intervalMinutes,
                      dayStartMinute,
                      dayEndMinute,
                    )
                    if (pos.outOfBounds) return null
                    return (
                      <button
                        key={sb.id}
                        type="button"
                        onClick={() => canManageBlocks && cancelBlock(sb.id)}
                        title={`${sb.reason} — ${sb.doctorName ?? ''} ${sb.startTime}–${sb.endTime}${canManageBlocks ? ' — clique para cancelar' : ''}`}
                        className={cn(
                          'absolute z-10 flex flex-col gap-0.5 overflow-hidden rounded-md border border-slate-500 bg-slate-700/85 px-1.5 py-1 text-left text-[11px] text-white shadow-sm',
                          canManageBlocks && 'cursor-pointer hover:bg-slate-900',
                          !canManageBlocks && 'cursor-default',
                        )}
                        style={{
                          top: `${pos.topRem}rem`,
                          height: `${pos.heightRem}rem`,
                          left: `2px`,
                          right: `2px`,
                        }}
                      >
                        <span className="flex items-center gap-1 truncate font-bold leading-tight">
                          {cancellingBlockId === sb.id && cancellingId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Lock className="h-3 w-3" />
                          )}
                          {sb.reason}
                        </span>
                        <span className="truncate text-[10px] leading-tight opacity-80">
                          {sb.startTime}–{sb.endTime} · {sb.doctorName ?? ''}
                        </span>
                      </button>
                    )
                  })}

                  {lanes.visible.map((assignment) => (
                    <CalendarBlock
                      key={assignment.block.id}
                      assignment={assignment}
                      overlapsBlock={overlappingApptIds.has(assignment.block.id)}
                      intervalMinutes={intervalMinutes}
                      dayStartMinute={dayStartMinute}
                      dayEndMinute={dayEndMinute}
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
              intervalMinutes={intervalMinutes}
              dayStartMinute={dayStartMinute}
              dayEndMinute={dayEndMinute}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
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
