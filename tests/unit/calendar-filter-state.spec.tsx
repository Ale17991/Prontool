/**
 * Feature 010 (US4 — T044) — Round-trip URL ↔ filtros.
 *
 * Cobertura:
 *  - Default state quando URL vazia.
 *  - Parse de cada filtro válido.
 *  - Filtros inválidos são silenciosamente ignorados (FR-036).
 *  - Serialização não inclui defaults (URL fica enxuta).
 *  - Range derivado de view+date.
 */
import { describe, it, expect } from 'vitest'
import {
  __testing,
  type CalendarFilters,
} from '@/app/(dashboard)/operacao/atendimentos/use-calendar-filters'

const { parseFilters, filtersToParams, deriveRange, todayIso } = __testing

function parseUrl(qs: string): CalendarFilters {
  return parseFilters(new URLSearchParams(qs))
}

describe('useCalendarFilters — round-trip URL ↔ state', () => {
  it('default state quando URL vazia', () => {
    const f = parseUrl('')
    expect(f.view).toBe('semana')
    expect(f.date).toBe(todayIso())
    expect(f.from).toBeNull()
    expect(f.to).toBeNull()
    expect(f.doctor).toBeNull()
    expect(f.status).toBeNull()
    expect(f.procedure).toBeNull()
    expect(f.patient).toBeNull()
  })

  it('parsea view e date válidos', () => {
    const f = parseUrl('view=mes&date=2026-05-15')
    expect(f.view).toBe('mes')
    expect(f.date).toBe('2026-05-15')
  })

  it('view inválido cai para semana (FR-036)', () => {
    const f = parseUrl('view=ano')
    expect(f.view).toBe('semana')
  })

  it('date inválido cai para hoje (FR-036)', () => {
    const f = parseUrl('date=invalid')
    expect(f.date).toBe(todayIso())
  })

  it('parsea status e ignora valores fora do enum', () => {
    expect(parseUrl('status=agendado').status).toBe('agendado')
    expect(parseUrl('status=realizado').status).toBe('realizado')
    expect(parseUrl('status=cancelado').status).toBe('cancelado')
    expect(parseUrl('status=foo').status).toBeNull()
  })

  it('parsea doctor apenas se UUID válido', () => {
    const valid = '11111111-2222-3333-4444-555555555555'
    expect(parseUrl(`doctor=${valid}`).doctor).toBe(valid)
    expect(parseUrl('doctor=not-a-uuid').doctor).toBeNull()
  })

  it('parsea procedure e patient com trim e max 60', () => {
    expect(parseUrl('procedure=  Limpeza  ').procedure).toBe('Limpeza')
    const longStr = 'a'.repeat(80)
    expect(parseUrl(`procedure=${longStr}`).procedure?.length).toBe(60)
    expect(parseUrl('procedure=').procedure).toBeNull()
  })

  it('serializa estado custom mantendo apenas non-defaults', () => {
    const today = todayIso()
    const filters: CalendarFilters = {
      view: 'semana',
      date: today,
      from: null,
      to: null,
      doctor: null,
      status: 'cancelado',
      procedure: null,
      patient: null,
    }
    const params = filtersToParams(filters)
    expect(params.toString()).toBe('status=cancelado')
  })

  it('full default → query string vazia', () => {
    const filters: CalendarFilters = {
      view: 'semana',
      date: todayIso(),
      from: null,
      to: null,
      doctor: null,
      status: null,
      procedure: null,
      patient: null,
    }
    expect(filtersToParams(filters).toString()).toBe('')
  })

  it('round-trip preserva filtros não-default', () => {
    const original: CalendarFilters = {
      view: 'mes',
      date: '2026-05-01',
      from: null,
      to: null,
      doctor: '11111111-2222-3333-4444-555555555555',
      status: 'agendado',
      procedure: 'limpeza',
      patient: 'Maria',
    }
    const qs = filtersToParams(original).toString()
    const parsed = parseUrl(qs)
    expect(parsed).toEqual(original)
  })

  it('deriveRange de view=semana centraliza na data', () => {
    const filters: CalendarFilters = {
      ...parseUrl(''),
      view: 'semana',
      date: '2026-05-13', // quarta-feira
    }
    const { from, to } = deriveRange(filters)
    // Domingo a sábado contendo 2026-05-13
    expect(from.getDate()).toBe(10) // domingo 10/05
    expect(to.getDate()).toBe(16) // sábado 16/05
  })

  it('deriveRange de view=mes inclui semanas parciais', () => {
    const filters: CalendarFilters = {
      ...parseUrl(''),
      view: 'mes',
      date: '2026-05-15',
    }
    const { from, to } = deriveRange(filters)
    // Maio 2026 inicia sex 1/05, então grid começa dom 26/04.
    expect(from.getDate()).toBe(26)
    expect(from.getMonth()).toBe(3) // abril
    // Termina sáb após 31/05 → 6/06.
    expect(to.getMonth()).toBeGreaterThanOrEqual(4) // ≥ maio (pode ser jun)
  })

  it('range custom sobrepõe view-derived', () => {
    const filters: CalendarFilters = {
      ...parseUrl(''),
      from: '2026-01-01',
      to: '2026-01-31',
    }
    const { from, to } = deriveRange(filters)
    expect(from.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(to.toISOString().slice(0, 10)).toBe('2026-01-31')
  })
})
