import { describe, it, expect } from 'vitest'
import {
  calcCal,
  calcIndicators,
  isValidProbingDepth,
  isValidRecession,
  type PerioMeasurementInput,
  type PerioFindingInput,
} from '@/lib/core/dental/perio/sites'

describe('perio calcCal', () => {
  it('soma profundidade + recessão positiva', () => {
    expect(calcCal(4, 2)).toBe(6)
  })
  it('recessão negativa (margem coronal) reduz o CAL', () => {
    expect(calcCal(4, -1)).toBe(3)
  })
  it('recessão nula é tratada como 0', () => {
    expect(calcCal(3, null)).toBe(3)
  })
  it('sem profundidade → null', () => {
    expect(calcCal(null, 2)).toBeNull()
  })
})

describe('perio faixas plausíveis', () => {
  it('aceita PD 0..15 e rejeita fora', () => {
    expect(isValidProbingDepth(0)).toBe(true)
    expect(isValidProbingDepth(15)).toBe(true)
    expect(isValidProbingDepth(16)).toBe(false)
    expect(isValidProbingDepth(-1)).toBe(false)
  })
  it('aceita recessão -5..15 e rejeita fora', () => {
    expect(isValidRecession(-5)).toBe(true)
    expect(isValidRecession(15)).toBe(true)
    expect(isValidRecession(-6)).toBe(false)
    expect(isValidRecession(16)).toBe(false)
  })
})

describe('perio calcIndicators', () => {
  const m = (
    toothFdi: number,
    probingDepthMm: number | null,
    bleeding: boolean,
    recessionMm: number | null = 0,
  ): PerioMeasurementInput => ({ toothFdi, site: 'b', probingDepthMm, recessionMm, bleeding })

  it('BOP%, bolsas ≥4mm e CAL médio com base nos sítios medidos', () => {
    const measurements = [
      m(11, 3, true), // bleeding, não-bolsa
      m(12, 5, false), // bolsa
      m(13, 4, true), // bolsa + bleeding
      m(14, 2, false), // não-bolsa
    ]
    const r = calcIndicators(measurements, [])
    expect(r.sitesMeasured).toBe(4)
    expect(r.sitesBleeding).toBe(2)
    expect(r.bopPct).toBe(50)
    expect(r.pocketsGe4).toBe(2)
    expect(r.pocketsGe4Pct).toBe(50)
    expect(r.calAvgMm).toBe(3.5) // (3+5+4+2)/4
  })

  it('ignora dentes ausentes', () => {
    const measurements = [m(11, 6, true), m(21, 6, true)]
    const findings: PerioFindingInput[] = [{ toothFdi: 21, isMissing: true }]
    const r = calcIndicators(measurements, findings)
    expect(r.sitesMeasured).toBe(1)
    expect(r.pocketsGe4).toBe(1)
  })

  it('ignora sítios sem profundidade', () => {
    const measurements = [m(11, null, true), m(12, 3, false)]
    const r = calcIndicators(measurements, [])
    expect(r.sitesMeasured).toBe(1)
    expect(r.bopPct).toBe(0)
  })

  it('exame vazio → zeros e CAL null', () => {
    const r = calcIndicators([], [])
    expect(r.sitesMeasured).toBe(0)
    expect(r.bopPct).toBe(0)
    expect(r.calAvgMm).toBeNull()
  })
})
