'use client'

import { useEffect, useState } from 'react'
import { CALENDAR_HOUR_END, CALENDAR_HOUR_START, CALENDAR_SLOT_HEIGHT_REM } from '@/lib/utils/calendar'

interface Props {
  /** Index do dia atual na grid (0..6 para semana, 0 para dia). */
  currentDayIndex: number | null
  /** Total de colunas no grid. */
  columnCount: number
}

/**
 * Linha vermelha horizontal indicando a hora atual. Renderiza apenas
 * se o dia atual estiver visivel no grid e a hora estiver dentro de
 * [07:00, 22:00). Atualiza a cada 60s.
 */
export function CurrentTimeLine({ currentDayIndex, columnCount }: Props) {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (currentDayIndex === null || currentDayIndex < 0) return null

  const hour = now.getHours()
  const minute = now.getMinutes()
  if (hour < CALENDAR_HOUR_START || hour >= CALENDAR_HOUR_END) return null

  const minutesFromStart = (hour - CALENDAR_HOUR_START) * 60 + minute
  const topRem = (minutesFromStart / 60) * CALENDAR_SLOT_HEIGHT_REM
  const colWidthPercent = 100 / columnCount
  const leftPercent = currentDayIndex * colWidthPercent

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-20 flex items-center"
      style={{
        top: `${topRem}rem`,
        left: `${leftPercent}%`,
        width: `${colWidthPercent}%`,
      }}
    >
      <span className="-ml-1.5 h-3 w-3 rounded-full bg-rose-500 shadow ring-2 ring-white" />
      <span className="h-px flex-1 bg-rose-500" />
    </div>
  )
}
