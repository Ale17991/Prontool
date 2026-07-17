/**
 * T024 (Feature 046) — equações de gasto energético vs. gabarito.
 *
 * Gabaritos calculados a partir das fórmulas (coeficientes canônicos onde a
 * planilha divergia — ver nutri-doc/formulas-referencia.md). Caso base:
 * M, 30 anos, 80 kg, 180 cm, MLG 64 kg.
 */
import { describe, it, expect } from 'vitest'
import { computeEnergy, computeTmb, computeGet, type EnergyInput } from '@/lib/core/nutrition/energy'
import { NutritionInputError } from '@/lib/core/nutrition/body-composition'

const base: EnergyInput = {
  sex: 'M',
  ageYears: 30,
  weightKg: 80,
  heightCm: 180,
  leanMassKg: 64,
  equation: 'mifflin',
}

describe('Feature 046 — TMB por equação', () => {
  const cases: { eq: EnergyInput['equation']; expected: number }[] = [
    { eq: 'mifflin', expected: 1780 }, // 10·80 + 6.25·180 − 5·30 + 5
    { eq: 'harris_benedict_1984', expected: 1854 },
    { eq: 'harris_benedict_1919', expected: 1865 },
    { eq: 'katch_mcardle', expected: 1752 }, // 370 + 21.6·64
    { eq: 'cunningham', expected: 1908 }, // 500 + 22·64
    { eq: 'tinsley_peso', expected: 1994 }, // 24.8·80 + 10
    { eq: 'tinsley_mlg', expected: 1942 }, // 25.9·64 + 284
    { eq: 'fao_who_1985', expected: 1807 }, // 11.6·80 + 879
    { eq: 'fao_who_2004', expected: 1791 }, // 11.472·80 + 873.1
    { eq: 'schofield', expected: 1791 }, // (0.048·80 + 3.653)·239
    { eq: 'henry_rees', expected: 1635 }, // (0.046·80 + 3.16)·239
  ]
  for (const c of cases) {
    it(`${c.eq} → ${c.expected} kcal`, () => {
      expect(Math.round(computeTmb({ ...base, equation: c.eq }))).toBe(c.expected)
    })
  }

  it('EER/IOM 2005 adulto (PA 1.0) já é total', () => {
    // 662 − 9.53·30 + (15.91·80 + 539.6·1.8) = 2620
    expect(Math.round(computeTmb({ ...base, equation: 'eer_iom_2005', eerPa: 1.0 }))).toBe(2620)
  })

  it('EER 2023 adulto categoria 1', () => {
    // 753.07 − 10.83·30 + 6.5·180 + 14.1·80 = 2726
    expect(Math.round(computeTmb({ ...base, equation: 'eer_2023', eerCategory: 1 }))).toBe(2726)
  })
})

describe('Feature 046 — GET, VET e macros', () => {
  it('GET clássico = TMB × PAL × injúria (+extra)', () => {
    const tmb = computeTmb(base) // 1780
    expect(Math.round(computeGet({ ...base, activityFactor: 1.55 }, tmb))).toBe(2759)
  })

  it('EER: GET = o próprio valor EER (injúria 1)', () => {
    const eer = computeTmb({ ...base, equation: 'eer_iom_2005', eerPa: 1.0 })
    expect(Math.round(computeGet({ ...base, equation: 'eer_iom_2005' }, eer))).toBe(2620)
  })

  it('VET-meta e macros a partir do objetivo', () => {
    const r = computeEnergy({
      ...base,
      activityFactor: 1.55,
      objective: 'deficit',
      objectiveDeltaKcal: -500,
      macros: { protPct: 30, carbPct: 40, lipPct: 30 },
    })
    expect(r.getKcal).toBe(2759)
    expect(r.targetKcal).toBe(2259)
    expect(r.macros?.protG).toBe(169) // 2259·0.3/4
    expect(r.macros?.carbG).toBe(226) // 2259·0.4/4
    expect(r.macros?.lipG).toBe(75) // 2259·0.3/9
  })

  it('macros que não somam 100% são rejeitados', () => {
    expect(() =>
      computeEnergy({ ...base, activityFactor: 1.2, macros: { protPct: 30, carbPct: 30, lipPct: 30 } }),
    ).toThrow(/100%/)
  })
})

describe('Feature 046 — validações do motor', () => {
  it('Katch-McArdle sem massa magra → MISSING_LEAN_MASS', () => {
    expect(() => computeTmb({ ...base, equation: 'katch_mcardle', leanMassKg: null })).toThrow(
      NutritionInputError,
    )
  })

  it('equação de gestante para homem → EQUATION_FEMALE_ONLY', () => {
    expect(() => computeEnergy({ ...base, equation: 'eer_gestante' })).toThrow(/mulheres/i)
  })
})
