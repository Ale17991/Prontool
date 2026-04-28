/**
 * Unit tests for src/lib/utils/calendar.ts — pure helpers, no DB / DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  CALENDAR_HOUR_START,
  CALENDAR_SLOT_HEIGHT_REM,
  DEFAULT_DURATION_MINUTES,
  MAX_LANES,
  appointmentEnd,
  assignLanes,
  durationFromTimestamps,
  getDayRange,
  getMonthRange,
  getWeekRange,
  isMobileBreakpoint,
  isoDate,
  parseIsoDate,
  slotForAppointment,
  toDateTimeLocalValue,
} from '@/lib/utils/calendar'

describe('calendar utils', () => {
  describe('getWeekRange', () => {
    it('returns sunday-to-saturday with 7 days', () => {
      // Wednesday 2026-04-29 (today's anchor)
      const range = getWeekRange(new Date(2026, 3, 29))
      expect(range.days).toHaveLength(7)
      expect(range.start.getDay()).toBe(0) // domingo
      expect(range.days[0]?.getDay()).toBe(0)
      expect(range.days[6]?.getDay()).toBe(6) // sabado
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime())
    })
  })

  describe('getDayRange', () => {
    it('returns single-day range starting at midnight', () => {
      const range = getDayRange(new Date(2026, 4, 5, 14, 30))
      expect(range.days).toHaveLength(1)
      expect(range.start.getHours()).toBe(0)
      expect(range.start.getMinutes()).toBe(0)
    })
  })

  describe('getMonthRange', () => {
    it('covers the full calendar month', () => {
      const range = getMonthRange(new Date(2026, 4, 15)) // Maio/2026
      expect(range.days[0]?.getDate()).toBe(1)
      expect(range.days.at(-1)?.getDate()).toBe(31)
      expect(range.days).toHaveLength(31)
    })
  })

  describe('slotForAppointment', () => {
    it('positions 9:00 / 30 min within bounds', () => {
      const at = new Date(2026, 4, 5, 9, 0)
      const pos = slotForAppointment(at, 30)
      expect(pos.outOfBounds).toBe(false)
      expect(pos.startHour).toBe(9)
      // 9 - 7 = 2h => 2 * 4rem = 8rem
      expect(pos.topRem).toBe((9 - CALENDAR_HOUR_START) * CALENDAR_SLOT_HEIGHT_REM)
      // 30 / 60 * 4rem = 2rem
      expect(pos.heightRem).toBe(2)
    })

    it('flags out-of-bounds before 07:00', () => {
      const at = new Date(2026, 4, 5, 6, 30)
      const pos = slotForAppointment(at, 30)
      expect(pos.outOfBounds).toBe(true)
    })

    it('flags out-of-bounds after 22:00', () => {
      const at = new Date(2026, 4, 5, 22, 0)
      const pos = slotForAppointment(at, 30)
      expect(pos.outOfBounds).toBe(true)
    })

    it('uses minimum height for very short appointments', () => {
      const at = new Date(2026, 4, 5, 10, 0)
      const pos = slotForAppointment(at, 5)
      // minimo de 15min => 15/60*4 = 1rem
      expect(pos.heightRem).toBe(1)
    })
  })

  describe('assignLanes', () => {
    function block(id: string, h1: number, h2: number) {
      return {
        id,
        start: new Date(2026, 4, 5, h1, 0),
        end: new Date(2026, 4, 5, h2, 0),
      }
    }

    it('assigns single block to lane 0', () => {
      const r = assignLanes([block('a', 9, 10)])
      expect(r.visible).toHaveLength(1)
      expect(r.visible[0]?.lane).toBe(0)
      expect(r.visible[0]?.totalLanes).toBe(1)
      expect(r.overflow).toEqual([])
    })

    it('two overlapping go to lanes 0 and 1', () => {
      const r = assignLanes([block('a', 9, 11), block('b', 10, 12)])
      expect(r.visible).toHaveLength(2)
      const lanes = r.visible.map((v) => v.lane).sort()
      expect(lanes).toEqual([0, 1])
      expect(r.visible.every((v) => v.totalLanes === 2)).toBe(true)
    })

    it('non-overlapping reuse lane 0', () => {
      const r = assignLanes([block('a', 9, 10), block('b', 10, 11)])
      expect(r.visible).toHaveLength(2)
      expect(r.visible.every((v) => v.lane === 0)).toBe(true)
    })

    it('overflows when more than MAX_LANES overlap', () => {
      const blocks = Array.from({ length: MAX_LANES + 2 }, (_, i) =>
        block(`b${i}`, 10, 12),
      )
      const r = assignLanes(blocks)
      expect(r.visible).toHaveLength(MAX_LANES)
      expect(r.overflow).toHaveLength(2)
    })
  })

  describe('isMobileBreakpoint', () => {
    it('flags widths under 640', () => {
      expect(isMobileBreakpoint(320)).toBe(true)
      expect(isMobileBreakpoint(639)).toBe(true)
      expect(isMobileBreakpoint(640)).toBe(false)
      expect(isMobileBreakpoint(1024)).toBe(false)
    })
  })

  describe('appointmentEnd / durationFromTimestamps', () => {
    it('round-trips a duration', () => {
      const start = new Date(2026, 4, 5, 9, 0)
      const end = appointmentEnd(start, 45)
      expect(durationFromTimestamps(start, end)).toBe(45)
    })
  })

  describe('toDateTimeLocalValue', () => {
    it('formats as YYYY-MM-DDTHH:MM', () => {
      const d = new Date(2026, 4, 5, 14, 30)
      expect(toDateTimeLocalValue(d)).toBe('2026-05-05T14:30')
    })
  })

  describe('parseIsoDate / isoDate', () => {
    it('round-trips an ISO date', () => {
      const d = new Date(2026, 4, 5)
      const s = isoDate(d)
      expect(s).toBe('2026-05-05')
      expect(parseIsoDate(s)?.getTime()).toBe(d.getTime())
    })

    it('returns null for invalid input', () => {
      expect(parseIsoDate(undefined)).toBeNull()
      expect(parseIsoDate('not-a-date')).toBeNull()
      expect(parseIsoDate('')).toBeNull()
    })
  })

  it('exposes default duration constant', () => {
    expect(DEFAULT_DURATION_MINUTES).toBe(30)
  })
})
