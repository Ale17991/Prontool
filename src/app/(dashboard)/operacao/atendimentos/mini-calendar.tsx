'use client'

import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Feature 010 (US4 / R10) — mini-calendário sem nova dep.
 *
 * Grid 7×6 com:
 *   - dias do mês destacados; dias fora do mês esmaecidos.
 *   - dias com atendimento marcados com ponto (hasAppointmentsByDay).
 *   - clique navega para o dia (onSelect).
 *   - setas no header navegam mês a mês (onNavigateMonth).
 */

export interface MiniCalendarProps {
  value: Date
  hasAppointmentsByDay: Set<string> // 'YYYY-MM-DD'
  onSelect(date: Date): void
  onNavigateMonth?(direction: -1 | 1): void
}

const WEEK_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

export function MiniCalendar({
  value,
  hasAppointmentsByDay,
  onSelect,
  onNavigateMonth,
}: MiniCalendarProps) {
  const monthAnchor = startOfMonth(value)
  const gridStart = startOfWeek(monthAnchor, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 })

  const days: Date[] = []
  for (let cur = gridStart; cur <= gridEnd; cur = addDays(cur, 1)) {
    days.push(new Date(cur))
  }

  return (
    <div className="w-full max-w-[260px] rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigateMonth?.(-1)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        <span className="text-[11px] font-semibold capitalize text-slate-700">
          {format(value, 'LLLL yyyy', { locale: ptBR })}
        </span>
        <button
          type="button"
          onClick={() => onNavigateMonth?.(1)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-slate-400">
        {WEEK_LABELS.map((l, i) => (
          <span key={`${l}-${i}`} className="py-1 font-bold uppercase">
            {l}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const inMonth = isSameMonth(d, monthAnchor)
          const isSelected = isSameDay(d, value)
          const iso = format(d, 'yyyy-MM-dd')
          const hasAppt = hasAppointmentsByDay.has(iso)
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(d)}
              className={cn(
                'relative flex h-7 w-full items-center justify-center rounded text-[11px] font-medium transition-colors',
                inMonth ? 'text-slate-700' : 'text-slate-300',
                isSelected
                  ? 'bg-primary text-white shadow-sm hover:bg-primary'
                  : 'hover:bg-slate-100',
              )}
            >
              {d.getDate()}
              {hasAppt && !isSelected ? (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary/70" />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}
