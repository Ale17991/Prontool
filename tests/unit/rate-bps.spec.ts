/**
 * T013 — Unit tests para src/lib/validation/rate-bps.ts.
 * Cobre: pt-BR/en-US parsing, half-up, edge cases, roundtrip.
 * Sem DB — função pura.
 */
import { describe, it, expect } from 'vitest'
import { percentToBps, bpsToPercent, bpsValid } from '@/lib/validation/rate-bps'

describe('percentToBps', () => {
  describe('pt-BR (vírgula)', () => {
    it('converte "6,50" para 650', () => {
      expect(percentToBps('6,50')).toBe(650)
    })
    it('converte "6,5" para 650', () => {
      expect(percentToBps('6,5')).toBe(650)
    })
    it('converte "0,01" para 1', () => {
      expect(percentToBps('0,01')).toBe(1)
    })
    it('converte "100,00" para 10000', () => {
      expect(percentToBps('100,00')).toBe(10000)
    })
  })

  describe('en-US (ponto) — tolerância', () => {
    it('converte "6.50" para 650', () => {
      expect(percentToBps('6.50')).toBe(650)
    })
    it('converte "6.5" para 650', () => {
      expect(percentToBps('6.5')).toBe(650)
    })
  })

  describe('inteiros sem decimal', () => {
    it('converte "6" para 600', () => {
      expect(percentToBps('6')).toBe(600)
    })
    it('converte "0" para 0', () => {
      expect(percentToBps('0')).toBe(0)
    })
    it('converte "100" para 10000', () => {
      expect(percentToBps('100')).toBe(10000)
    })
  })

  describe('arredondamento half-up a 2 casas', () => {
    it('arredonda "6,505" para 651 (half-up)', () => {
      expect(percentToBps('6,505')).toBe(651)
    })
    it('arredonda "6,504" para 650 (round-down)', () => {
      expect(percentToBps('6,504')).toBe(650)
    })
    it('arredonda "0,001" para 0', () => {
      expect(percentToBps('0,001')).toBe(0)
    })
    it('arredonda "0,005" para 1 (half-up)', () => {
      expect(percentToBps('0,005')).toBe(1)
    })
  })

  describe('whitespace', () => {
    it('trim leading/trailing', () => {
      expect(percentToBps('  6,50  ')).toBe(650)
    })
  })

  describe('rejeições', () => {
    it('rejeita vazio', () => {
      expect(() => percentToBps('')).toThrow(RangeError)
    })
    it('rejeita apenas espaços', () => {
      expect(() => percentToBps('   ')).toThrow(RangeError)
    })
    it('rejeita negativo', () => {
      expect(() => percentToBps('-1')).toThrow(/maior ou igual/)
    })
    it('rejeita > 100', () => {
      expect(() => percentToBps('100,01')).toThrow(/100%/)
    })
    it('rejeita NaN/letras', () => {
      expect(() => percentToBps('abc')).toThrow(RangeError)
    })
    it('rejeita múltiplos separadores', () => {
      expect(() => percentToBps('1,2,3')).toThrow(/separador/)
    })
    it('rejeita misto vírgula+ponto', () => {
      expect(() => percentToBps('1,2.3')).toThrow(/separador/)
    })
  })
})

describe('bpsToPercent', () => {
  it('formata 650 como "6,50"', () => {
    expect(bpsToPercent(650)).toBe('6,50')
  })
  it('formata 0 como "0,00"', () => {
    expect(bpsToPercent(0)).toBe('0,00')
  })
  it('formata 10000 como "100,00"', () => {
    expect(bpsToPercent(10000)).toBe('100,00')
  })
  it('formata 1 como "0,01"', () => {
    expect(bpsToPercent(1)).toBe('0,01')
  })
  it('formata 99 como "0,99"', () => {
    expect(bpsToPercent(99)).toBe('0,99')
  })
  it('rejeita decimal', () => {
    expect(() => bpsToPercent(6.5)).toThrow(RangeError)
  })
  it('rejeita negativo', () => {
    expect(() => bpsToPercent(-1)).toThrow(RangeError)
  })
  it('rejeita > 10000', () => {
    expect(() => bpsToPercent(10001)).toThrow(RangeError)
  })
})

describe('bpsValid', () => {
  it('aceita 0', () => expect(bpsValid(0)).toBe(true))
  it('aceita 10000', () => expect(bpsValid(10000)).toBe(true))
  it('aceita 5000', () => expect(bpsValid(5000)).toBe(true))
  it('rejeita -1', () => expect(bpsValid(-1)).toBe(false))
  it('rejeita 10001', () => expect(bpsValid(10001)).toBe(false))
  it('rejeita decimal', () => expect(bpsValid(6.5)).toBe(false))
  it('rejeita NaN', () => expect(bpsValid(NaN)).toBe(false))
  it('rejeita Infinity', () => expect(bpsValid(Infinity)).toBe(false))
})

describe('roundtrip', () => {
  for (const bps of [0, 1, 50, 500, 650, 1234, 5000, 9999, 10000]) {
    it(`bps=${bps} → percent → bps preserva valor`, () => {
      const percent = bpsToPercent(bps)
      expect(percentToBps(percent)).toBe(bps)
    })
  }
})
