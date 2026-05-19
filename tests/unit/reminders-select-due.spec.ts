/**
 * T026 (Feature 018) — unit test dos helpers puros de select-due.
 *
 * Testa apenas funções sem dependência de DB: isWithinWindow + isWeekend.
 * O `selectDueAppointments` em si requer Supabase ativo e é testado no
 * contract test (Phase 5, com Docker).
 */

import { describe, it, expect } from 'vitest'
import { isWithinWindow, isWeekend } from '@/lib/core/reminders/select-due'

describe('isWithinWindow (TZ-aware)', () => {
  it('aceita horário dentro da janela 08:00-20:00 (Brasília)', () => {
    // 2026-05-20 14:00 UTC = 11:00 Brasília
    const now = new Date('2026-05-20T14:00:00Z')
    expect(isWithinWindow(now, '08:00', '20:00')).toBe(true)
  })

  it('rejeita 03:00 Brasília (fora da janela default)', () => {
    // 2026-05-20 06:00 UTC = 03:00 Brasília
    const now = new Date('2026-05-20T06:00:00Z')
    expect(isWithinWindow(now, '08:00', '20:00')).toBe(false)
  })

  it('rejeita 22:00 Brasília (fora da janela default)', () => {
    // 2026-05-20 01:00 UTC do dia 21 = 22:00 Brasília do dia 20
    const now = new Date('2026-05-21T01:00:00Z')
    expect(isWithinWindow(now, '08:00', '20:00')).toBe(false)
  })

  it('aceita exatamente no limite inferior', () => {
    // 2026-05-20 11:00 UTC = 08:00 Brasília
    const now = new Date('2026-05-20T11:00:00Z')
    expect(isWithinWindow(now, '08:00', '20:00')).toBe(true)
  })

  it('aceita exatamente no limite superior', () => {
    // 2026-05-20 23:00 UTC = 20:00 Brasília
    const now = new Date('2026-05-20T23:00:00Z')
    expect(isWithinWindow(now, '08:00', '20:00')).toBe(true)
  })

  it('aceita janela 07:00-22:00 mais ampla', () => {
    // 21:00 Brasília
    const now = new Date('2026-05-21T00:00:00Z')
    expect(isWithinWindow(now, '07:00', '22:00')).toBe(true)
  })
})

describe('isWeekend (TZ-aware)', () => {
  it('sábado retorna true', () => {
    // 2026-05-23 = sábado
    const sat = new Date('2026-05-23T14:00:00Z')
    expect(isWeekend(sat)).toBe(true)
  })

  it('domingo retorna true', () => {
    // 2026-05-24 = domingo
    const sun = new Date('2026-05-24T14:00:00Z')
    expect(isWeekend(sun)).toBe(true)
  })

  it('segunda retorna false', () => {
    // 2026-05-18 = segunda
    const mon = new Date('2026-05-18T14:00:00Z')
    expect(isWeekend(mon)).toBe(false)
  })

  it('sexta retorna false', () => {
    // 2026-05-22 = sexta
    const fri = new Date('2026-05-22T14:00:00Z')
    expect(isWeekend(fri)).toBe(false)
  })
})
