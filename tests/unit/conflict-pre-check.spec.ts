/**
 * Unit tests para `intervalsOverlap` — math de overlap de intervalos
 * semi-abertos `[start, end)`. Cobre os cenarios da spec US1.
 */
import { describe, expect, it } from 'vitest'
import { intervalsOverlap } from '@/lib/core/appointments/check-conflict'

function d(hh: number, mm = 0): Date {
  return new Date(2026, 4, 5, hh, mm, 0, 0)
}

describe('intervalsOverlap (semi-open intervals)', () => {
  it('back-to-back does NOT overlap', () => {
    // 14:00–14:30 e 14:30–15:00
    expect(intervalsOverlap(d(14, 0), d(14, 30), d(14, 30), d(15, 0))).toBe(false)
    expect(intervalsOverlap(d(14, 30), d(15, 0), d(14, 0), d(14, 30))).toBe(false)
  })

  it('partial overlap on the right', () => {
    // 14:00–14:30 vs 14:15–14:45
    expect(intervalsOverlap(d(14, 0), d(14, 30), d(14, 15), d(14, 45))).toBe(true)
  })

  it('partial overlap on the left', () => {
    // 14:15–14:45 vs 14:00–14:30
    expect(intervalsOverlap(d(14, 15), d(14, 45), d(14, 0), d(14, 30))).toBe(true)
  })

  it('contained interval overlaps', () => {
    // 14:00–15:00 contem 14:15–14:45
    expect(intervalsOverlap(d(14, 0), d(15, 0), d(14, 15), d(14, 45))).toBe(true)
    expect(intervalsOverlap(d(14, 15), d(14, 45), d(14, 0), d(15, 0))).toBe(true)
  })

  it('disjoint intervals do not overlap', () => {
    // 09:00–09:30 vs 14:00–14:30
    expect(intervalsOverlap(d(9, 0), d(9, 30), d(14, 0), d(14, 30))).toBe(false)
  })

  it('identical intervals overlap', () => {
    expect(intervalsOverlap(d(14, 0), d(14, 30), d(14, 0), d(14, 30))).toBe(true)
  })

  it('single-point boundary at end does not count (semi-open)', () => {
    // a end == b start
    expect(intervalsOverlap(d(14, 0), d(14, 30), d(14, 30), d(14, 31))).toBe(false)
  })
})
