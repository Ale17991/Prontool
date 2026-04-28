/**
 * Pure helpers for the appointments calendar (feature 004).
 *
 * No DOM, no fetch — testable in Node. All time math uses date-fns to keep
 * timezone behavior consistent. Caller is expected to feed already-localized
 * Date instances (i.e., the calling component converts UTC → fuso da clinica
 * before passing in).
 */
import { addDays, addMinutes, differenceInMinutes, startOfDay, startOfWeek } from 'date-fns'

export const CALENDAR_HOUR_START = 7
export const CALENDAR_HOUR_END = 22 // exclusive — slots are [07:00, 22:00)
export const CALENDAR_HOUR_COUNT = CALENDAR_HOUR_END - CALENDAR_HOUR_START
export const CALENDAR_SLOT_HEIGHT_REM = 4
export const CALENDAR_DAY_START = 0 // domingo
export const MOBILE_BREAKPOINT_PX = 640
export const MAX_LANES = 4
export const DEFAULT_DURATION_MINUTES = 30

export interface WeekRange {
  start: Date // domingo 00:00
  end: Date // sabado 23:59:59
  days: Date[] // 7 entradas, midnight de cada dia
}

export function getWeekRange(date: Date): WeekRange {
  const start = startOfWeek(date, { weekStartsOn: CALENDAR_DAY_START })
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const end = new Date(addDays(start, 6).getTime() + 86_399_999)
  return { start, end, days }
}

export interface DayRange {
  start: Date
  end: Date
  days: [Date]
}

export function getDayRange(date: Date): DayRange {
  const start = startOfDay(date)
  const end = new Date(start.getTime() + 86_399_999)
  return { start, end, days: [start] }
}

export interface MonthRange {
  start: Date
  end: Date
  days: Date[]
}

export function getMonthRange(date: Date): MonthRange {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const days: Date[] = []
  for (let d = new Date(first); d <= last; d = addDays(d, 1)) days.push(new Date(d))
  const end = new Date(last.getTime() + 86_399_999)
  return { start: first, end, days }
}

export interface SlotPosition {
  /** Top offset em rem dentro da coluna do dia (relativo a CALENDAR_HOUR_START). */
  topRem: number
  /** Altura em rem proporcional a duracao. */
  heightRem: number
  /** Hora inteira de inicio (07..21). */
  startHour: number
  /** True quando o atendimento comeca antes de 07:00 ou depois de 22:00 (out-of-bounds). */
  outOfBounds: boolean
}

export function slotForAppointment(at: Date, durationMinutes: number): SlotPosition {
  const h = at.getHours()
  const m = at.getMinutes()
  const startsBefore = h < CALENDAR_HOUR_START
  const startsAfter = h >= CALENDAR_HOUR_END
  const outOfBounds = startsBefore || startsAfter
  const offsetMinutes = (h - CALENDAR_HOUR_START) * 60 + m
  const topRem = (offsetMinutes / 60) * CALENDAR_SLOT_HEIGHT_REM
  const minHeightMin = 15 // bloco minimo de 15 min para legibilidade
  const heightRem = (Math.max(durationMinutes, minHeightMin) / 60) * CALENDAR_SLOT_HEIGHT_REM
  return {
    topRem,
    heightRem,
    startHour: h,
    outOfBounds,
  }
}

export interface LaneAssignable {
  id: string
  start: Date
  end: Date
}

export interface LaneAssignment<T extends LaneAssignable> {
  block: T
  lane: number // 0..MAX_LANES-1
  totalLanes: number // quantas lanes em uso simultaneo nesse cluster
}

export interface LaneResult<T extends LaneAssignable> {
  visible: LaneAssignment<T>[]
  /** Atendimentos descartados quando o cluster excedeu MAX_LANES. */
  overflow: T[]
}

/**
 * Assina lane (0..MAX_LANES-1) para cada bloco de um dia. Algoritmo simples:
 *   - ordena por start ASC, duracao DESC
 *   - aloca na primeira lane disponivel
 *   - se passar de MAX_LANES, vira overflow (renderizado como "+N mais")
 *
 * `totalLanes` reflete o pico simultaneo no cluster do bloco — usado para
 * calcular largura proporcional na render.
 */
export function assignLanes<T extends LaneAssignable>(blocks: T[]): LaneResult<T> {
  const sorted = [...blocks].sort((a, b) => {
    const da = a.start.getTime() - b.start.getTime()
    if (da !== 0) return da
    const dura = a.end.getTime() - a.start.getTime()
    const durb = b.end.getTime() - b.start.getTime()
    return durb - dura
  })
  const visible: LaneAssignment<T>[] = []
  const overflow: T[] = []
  // Lanes ativas: cada slot guarda end-time da ocupacao; livre quando end <= start novo.
  const lanes: Array<Date | null> = new Array(MAX_LANES).fill(null)
  for (const b of sorted) {
    let assigned = -1
    for (let i = 0; i < lanes.length; i++) {
      const occupiedUntil = lanes[i] ?? null
      if (occupiedUntil === null || occupiedUntil.getTime() <= b.start.getTime()) {
        assigned = i
        break
      }
    }
    if (assigned === -1) {
      overflow.push(b)
      continue
    }
    lanes[assigned] = b.end
    visible.push({ block: b, lane: assigned, totalLanes: 0 })
  }
  // Calcula totalLanes = pico de overlap em cada cluster.
  // Aproximacao simples: para cada bloco, conta quantos visiveis se sobrepoem a ele.
  for (const v of visible) {
    let overlap = 1
    for (const w of visible) {
      if (w === v) continue
      if (w.block.start.getTime() < v.block.end.getTime() && w.block.end.getTime() > v.block.start.getTime()) {
        overlap++
      }
    }
    v.totalLanes = Math.min(Math.max(overlap, 1), MAX_LANES)
  }
  return { visible, overflow }
}

export function isMobileBreakpoint(width: number): boolean {
  return width < MOBILE_BREAKPOINT_PX
}

export function appointmentEnd(at: Date, durationMinutes: number): Date {
  return addMinutes(at, durationMinutes)
}

export function durationFromTimestamps(start: Date, end: Date): number {
  return Math.max(differenceInMinutes(end, start), 0)
}

/**
 * Formata Date para o atributo `value` de `<input type="datetime-local">`:
 *   YYYY-MM-DDTHH:MM (sem segundos, sem timezone — input usa fuso local).
 */
export function toDateTimeLocalValue(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Parse "YYYY-MM-DD" em Date local (00:00). Util para querystring `week=`. */
export function parseIsoDate(s: string | undefined | null): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** "YYYY-MM-DD" em fuso local. */
export function isoDate(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
