'use client'

import { useState } from 'react'
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isoFromDate } from '../calendar-filters'

/**
 * Mini-calendário de navegação do modo Calendário.
 *
 * Só navega — não mostra atendimento nenhum. A página carrega apenas a janela
 * visível (`range`), então pintar densidade aqui daria "dia sem bolinha" para
 * todo mês vizinho, que é dado ausente disfarçado de dia vago.
 *
 * O cursor do mês é estado próprio: dá pra folhear novembro sem sair da semana
 * aberta. Ele reancora sozinho quando a data selecionada muda de mês por fora
 * (atalhos da FilterBar, setas da grade).
 */

interface Props {
  /** Dia âncora dos filtros (`filters.date`). */
  selectedDate: Date
  /** Janela hoje visível na grade — vem do `range` derivado dos filtros. */
  rangeStart: Date
  rangeEnd: Date
  /** Recebe a data em `YYYY-MM-DD`; a view (dia/semana/mês) é preservada. */
  onSelectDate: (iso: string) => void
}

// Iniciais de domingo a sábado. O título de cada coluna leva o nome inteiro
// porque "S" sozinho não distingue segunda de sexta no leitor de tela.
const WEEK_INITIALS = [
  { initial: 'D', label: 'Domingo' },
  { initial: 'S', label: 'Segunda' },
  { initial: 'T', label: 'Terça' },
  { initial: 'Q', label: 'Quarta' },
  { initial: 'Q', label: 'Quinta' },
  { initial: 'S', label: 'Sexta' },
  { initial: 'S', label: 'Sábado' },
]

export function MiniCalendar({ selectedDate, rangeStart, rangeEnd, onSelectDate }: Props) {
  const [cursor, setCursor] = useState(() => startOfMonth(selectedDate))

  // Reancora o cursor quando a seleção muda de mês por fora (ajuste de estado
  // durante o render — o efeito equivalente pintaria o mês errado por um frame).
  const selectedMonthKey = format(selectedDate, 'yyyy-MM')
  const [anchoredMonth, setAnchoredMonth] = useState(selectedMonthKey)
  if (selectedMonthKey !== anchoredMonth) {
    setAnchoredMonth(selectedMonthKey)
    setCursor(startOfMonth(selectedDate))
  }

  const today = new Date()
  const gridStart = startOfWeek(cursor, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })

  const days: Date[] = []
  for (let cur = new Date(gridStart); cur <= gridEnd; cur.setDate(cur.getDate() + 1)) {
    days.push(new Date(cur))
  }

  const monthLabel = format(cursor, "MMMM 'de' yyyy", { locale: ptBR })

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, -1))}
          aria-label="Mês anterior"
          className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-bold capitalize text-slate-700">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, 1))}
          aria-label="Próximo mês"
          className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEK_INITIALS.map((w, idx) => (
          <div
            key={`wd-${idx}`}
            title={w.label}
            aria-hidden="true"
            className="pb-1 text-center text-[10px] font-bold uppercase text-slate-400"
          >
            {w.initial}
          </div>
        ))}

        {days.map((d) => {
          const iso = isoFromDate(d)
          const inMonth = isSameMonth(d, cursor)
          const isToday = isSameDay(d, today)
          const isSelected = isSameDay(d, selectedDate)
          // A grade abre uma janela inteira (semana/mês), não um dia: destacá-la
          // responde "o que estou vendo?" sem precisar olhar de volta pra grade.
          const inRange = isWithinInterval(d, { start: rangeStart, end: rangeEnd })

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(iso)}
              aria-label={format(d, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
              aria-current={isSelected ? 'date' : undefined}
              className={cn(
                'flex h-7 items-center justify-center rounded-full text-[11px] tabular-nums transition-colors',
                inMonth ? 'text-slate-700' : 'text-slate-300',
                inRange && !isSelected && 'bg-accent font-semibold text-accent-foreground',
                !inRange && !isSelected && 'hover:bg-slate-100',
                isSelected && 'bg-primary font-bold text-primary-foreground hover:bg-primary/90',
                isToday && 'ring-1 ring-brand ring-offset-1 ring-offset-white',
                isToday && !isSelected && 'font-bold text-brand-text',
              )}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => onSelectDate(isoFromDate(today))}
        className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100"
      >
        Ir para hoje
      </button>
    </div>
  )
}
