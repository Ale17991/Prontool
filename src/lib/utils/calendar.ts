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
/** Intervalo (minutos) que cada linha representa quando a clínica não configurou. */
export const DEFAULT_SLOT_INTERVAL_MINUTES = 60
/** Janela padrão do dia (minutos desde a meia-noite) — 07:00 às 22:00. */
export const DEFAULT_DAY_START_MINUTE = CALENDAR_HOUR_START * 60
export const DEFAULT_DAY_END_MINUTE = CALENDAR_HOUR_END * 60

/** 'HH:MM' → minutos desde a meia-noite; usa `fallback` se inválido. */
export function hhmmToMinutes(hhmm: string | null | undefined, fallback: number): number {
  if (!hhmm) return fallback
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm)
  if (!m) return fallback
  const mins = Number(m[1]) * 60 + Number(m[2])
  return Number.isFinite(mins) ? mins : fallback
}

export interface CalendarSlotRow {
  /** Minutos desde o início da janela (0, interval, 2*interval, …). */
  offsetMinutes: number
  /** Rótulo HH:MM do início da linha (horário absoluto). */
  label: string
}

/**
 * Linhas da grade para um intervalo e uma janela [startMinute, endMinute).
 * Cada linha cobre `intervalMinutes` e mantém a mesma altura visual
 * (CALENDAR_SLOT_HEIGHT_REM); o que muda é o período representado. Defaults
 * (60 min, 07:00–22:00) reproduzem a grade horária clássica.
 */
export function buildCalendarSlots(
  intervalMinutes: number = DEFAULT_SLOT_INTERVAL_MINUTES,
  startMinute: number = DEFAULT_DAY_START_MINUTE,
  endMinute: number = DEFAULT_DAY_END_MINUTE,
): CalendarSlotRow[] {
  const step = clampInterval(intervalMinutes)
  const span = Math.max(0, endMinute - startMinute)
  const count = Math.ceil(span / step)
  const rows: CalendarSlotRow[] = []
  for (let i = 0; i < count; i++) {
    const offsetMinutes = i * step
    const abs = startMinute + offsetMinutes
    const h = Math.floor(abs / 60)
    const m = abs % 60
    rows.push({
      offsetMinutes,
      label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    })
  }
  return rows
}

function clampInterval(intervalMinutes: number): number {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
    return DEFAULT_SLOT_INTERVAL_MINUTES
  }
  return Math.min(Math.round(intervalMinutes), 1440)
}

/** rem por minuto para um intervalo: cada linha (intervalo) ocupa SLOT_HEIGHT_REM. */
export function remPerMinute(intervalMinutes: number = DEFAULT_SLOT_INTERVAL_MINUTES): number {
  return CALENDAR_SLOT_HEIGHT_REM / clampInterval(intervalMinutes)
}

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

export function slotForAppointment(
  at: Date,
  durationMinutes: number,
  intervalMinutes: number = DEFAULT_SLOT_INTERVAL_MINUTES,
  startMinute: number = DEFAULT_DAY_START_MINUTE,
  endMinute: number = DEFAULT_DAY_END_MINUTE,
): SlotPosition {
  const h = at.getHours()
  const m = at.getMinutes()
  const totalMin = h * 60 + m
  const outOfBounds = totalMin < startMinute || totalMin >= endMinute
  const offsetMinutes = totalMin - startMinute
  const perMin = remPerMinute(intervalMinutes)
  const topRem = offsetMinutes * perMin
  const minHeightMin = 15 // bloco minimo de 15 min para legibilidade
  const heightRem = Math.max(durationMinutes, minHeightMin) * perMin
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
  /** True quando o bloco se sobrepoe a outro do mesmo agrupador (US4 — visual). */
  conflict?: boolean
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

/**
 * Defesa em profundidade (US4): marca blocos sobrepostos do MESMO agrupador
 * (ex.: mesmo doctor) como conflict=true para o calendario destacar.
 *
 * Em uso normal a EXCLUDE constraint impede a entrada de slot_locks
 * conflitantes — entao isso so dispara para conflitos preexistentes (dado
 * legado, insercao forcada). Visualizacao em vermelho e o backup.
 */
export function detectVisualConflicts<T extends LaneAssignable>(
  assignments: LaneAssignment<T>[],
  groupKey: (block: T) => string,
): void {
  // O(n^2) por dia — n tipicamente <= 20 na pratica. Aceitavel.
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const a = assignments[i]
      const b = assignments[j]
      if (!a || !b) continue
      if (groupKey(a.block) !== groupKey(b.block)) continue
      const overlap =
        a.block.start.getTime() < b.block.end.getTime() &&
        a.block.end.getTime() > b.block.start.getTime()
      if (overlap) {
        a.conflict = true
        b.conflict = true
      }
    }
  }
}
