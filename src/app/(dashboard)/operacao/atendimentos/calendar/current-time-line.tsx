'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_DAY_END_MINUTE,
  DEFAULT_DAY_START_MINUTE,
  DEFAULT_SLOT_INTERVAL_MINUTES,
  remPerMinute,
} from '@/lib/utils/calendar'

interface Props {
  /** Index do dia atual na grid (0..6 para semana, 0 para dia). */
  currentDayIndex: number | null
  /** Total de colunas no grid. */
  columnCount: number
  /** Intervalo (minutos) que cada linha representa. */
  intervalMinutes?: number
  /** Janela do dia (minutos desde a meia-noite). */
  dayStartMinute?: number
  dayEndMinute?: number
}

/**
 * Linha vermelha horizontal indicando a hora atual. Renderiza apenas
 * se o dia atual estiver visivel no grid e a hora estiver dentro de
 * [07:00, 22:00). Atualiza a cada 60s.
 */
export function CurrentTimeLine({
  currentDayIndex,
  columnCount,
  intervalMinutes = DEFAULT_SLOT_INTERVAL_MINUTES,
  dayStartMinute = DEFAULT_DAY_START_MINUTE,
  dayEndMinute = DEFAULT_DAY_END_MINUTE,
}: Props) {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (currentDayIndex === null || currentDayIndex < 0) return null

  const totalMin = now.getHours() * 60 + now.getMinutes()
  if (totalMin < dayStartMinute || totalMin >= dayEndMinute) return null

  const minutesFromStart = totalMin - dayStartMinute
  const topRem = minutesFromStart * remPerMinute(intervalMinutes)
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
      <span className="-ml-1.5 h-3 w-3 rounded-full bg-alert shadow ring-2 ring-white" />
      <span className="h-px flex-1 bg-alert" />
    </div>
  )
}
