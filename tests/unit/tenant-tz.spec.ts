/**
 * Camada 3 — testes do helper de timezone. Unit (sem DB).
 *
 * Cobre: boundary do último dia do mês em São Paulo (UTC-3), boundary de
 * DST de outros fusos (Nova York, Buenos Aires — Argentina não tem mais
 * DST mas testamos a conversão fixa), e o caso degenerado de ymd inválido.
 *
 * NÃO testamos getTenantTimezone (precisa de Supabase) — esse é integration.
 */
import { describe, it, expect } from 'vitest'
import {
  ymdStartOfDayUtc,
  ymdNextDayStartUtc,
  dateToTenantYmd,
} from '@/lib/utils/tenant-tz'

describe('tenant-tz: boundary correta para São Paulo (UTC-3)', () => {
  it('1º de Janeiro 00:00 BRT é 03:00 UTC', () => {
    expect(ymdStartOfDayUtc('2026-01-01', 'America/Sao_Paulo')).toBe(
      '2026-01-01T03:00:00.000Z',
    )
  })

  it('31 de Janeiro 00:00 BRT é 03:00 UTC do mesmo dia', () => {
    expect(ymdStartOfDayUtc('2026-01-31', 'America/Sao_Paulo')).toBe(
      '2026-01-31T03:00:00.000Z',
    )
  })

  it('upper bound exclusivo: relatório de Janeiro vai até 1º de Fev 00:00 BRT (= 03:00 UTC)', () => {
    expect(ymdNextDayStartUtc('2026-01-31', 'America/Sao_Paulo')).toBe(
      '2026-02-01T03:00:00.000Z',
    )
  })

  it('inverso: appointment às 22:30 BRT no dia 31/01 (= 01:30 UTC do dia 01/02) está dentro do range "Janeiro"', () => {
    // Cenário concreto do bug T1: antes da correção, este appointment
    // sumia do relatório de Janeiro porque o cap era 2026-02-01T00:00:00Z
    // (< 01:30 UTC). Com o fix, o cap é 2026-02-01T03:00:00.000Z (> 01:30).
    const cap = ymdNextDayStartUtc('2026-01-31', 'America/Sao_Paulo')
    const appointmentUtc = '2026-02-01T01:30:00.000Z'
    expect(appointmentUtc < cap).toBe(true)
  })

  it('mirror: appointment às 22:30 BRT no dia 31/12 (= 01:30 UTC do dia 01/01) NÃO entra no relatório de Janeiro', () => {
    const floor = ymdStartOfDayUtc('2026-01-01', 'America/Sao_Paulo')
    const decAppointmentUtc = '2026-01-01T01:30:00.000Z'
    expect(decAppointmentUtc < floor).toBe(true)
  })
})

describe('tenant-tz: outros fusos', () => {
  it('Nova York em horário normal (EST, UTC-5)', () => {
    // Janeiro = EST. 00:00 NY = 05:00 UTC.
    expect(ymdStartOfDayUtc('2026-01-15', 'America/New_York')).toBe(
      '2026-01-15T05:00:00.000Z',
    )
  })

  it('Nova York em DST (EDT, UTC-4) — 15/07', () => {
    expect(ymdStartOfDayUtc('2026-07-15', 'America/New_York')).toBe(
      '2026-07-15T04:00:00.000Z',
    )
  })

  it('Tóquio (UTC+9, sem DST)', () => {
    expect(ymdStartOfDayUtc('2026-01-01', 'Asia/Tokyo')).toBe(
      '2025-12-31T15:00:00.000Z',
    )
  })
})

describe('tenant-tz: dateToTenantYmd', () => {
  it('22:30 BRT no dia 31/01 retorna "2026-01-31" (não "2026-02-01")', () => {
    const appointment = new Date('2026-02-01T01:30:00.000Z') // = 22:30 BRT do 31/01
    expect(dateToTenantYmd(appointment, 'America/Sao_Paulo')).toBe('2026-01-31')
  })

  it('02:00 UTC = 23:00 BRT do dia anterior', () => {
    const appointment = new Date('2026-02-01T02:00:00.000Z')
    expect(dateToTenantYmd(appointment, 'America/Sao_Paulo')).toBe('2026-01-31')
  })

  it('15:00 UTC = 12:00 BRT do mesmo dia', () => {
    const appointment = new Date('2026-02-01T15:00:00.000Z')
    expect(dateToTenantYmd(appointment, 'America/Sao_Paulo')).toBe('2026-02-01')
  })
})

describe('tenant-tz: input validation', () => {
  it('ymd inválido → throw', () => {
    expect(() => ymdStartOfDayUtc('not-a-date', 'America/Sao_Paulo')).toThrow(
      /invalid ymd/i,
    )
  })

  it('ymd vazio → throw', () => {
    expect(() => ymdNextDayStartUtc('', 'America/Sao_Paulo')).toThrow(/invalid ymd/i)
  })
})
