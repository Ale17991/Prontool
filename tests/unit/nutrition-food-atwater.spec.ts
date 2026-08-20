/**
 * T015 (Feature 047 US1) — Atwater e plausibilidade de alimento.
 */
import { describe, expect, it } from 'vitest'
import {
  energyFromMacros,
  normalizeFoodNutrients,
  FoodInputError,
} from '@/lib/core/nutrition/foods/atwater'

describe('energyFromMacros (Atwater 4/4/9)', () => {
  it('deriva energia dos macros', () => {
    // whey: 24 P, 1 C, 0.5 L → 4*24 + 4*1 + 9*0.5 = 104.5
    expect(energyFromMacros(24, 1, 0.5)).toBe(104.5)
  })
})

describe('normalizeFoodNutrients', () => {
  const base = { referenceGrams: 100, proteinG: 10, carbG: 20, fatG: 5, fiberG: 2 }

  it('mantém a energia informada', () => {
    const r = normalizeFoodNutrients({ ...base, energyKcal: 165 })
    expect(r.energyKcal).toBe(165)
  })

  it('deriva a energia por Atwater quando ausente (FR-007)', () => {
    const r = normalizeFoodNutrients({ ...base, energyKcal: null })
    // 4*10 + 4*20 + 9*5 = 165
    expect(r.energyKcal).toBe(165)
  })

  it('arredonda em 2 casas', () => {
    const r = normalizeFoodNutrients({
      referenceGrams: 30,
      energyKcal: null,
      proteinG: 24,
      carbG: 1,
      fatG: 0.5,
      fiberG: null,
    })
    expect(r.energyKcal).toBe(104.5)
    expect(r.fiberG).toBeNull()
  })

  it('rejeita energia implausível', () => {
    expect(() => normalizeFoodNutrients({ ...base, energyKcal: 5000 })).toThrow(FoodInputError)
  })

  it('rejeita macro acima da porção de referência', () => {
    expect(() => normalizeFoodNutrients({ ...base, energyKcal: null, proteinG: 150 })).toThrow(
      /proteína/i,
    )
  })

  it('rejeita porção de referência não positiva', () => {
    expect(() => normalizeFoodNutrients({ ...base, referenceGrams: 0, energyKcal: 100 })).toThrow(
      FoodInputError,
    )
  })

  it('teto de energia acompanha a porção de referência', () => {
    // 30 g → teto 300 kcal; 250 passa, 400 não.
    expect(() =>
      normalizeFoodNutrients({
        referenceGrams: 30,
        energyKcal: 250,
        proteinG: 0,
        carbG: 0,
        fatG: 0,
        fiberG: null,
      }),
    ).not.toThrow()
    expect(() =>
      normalizeFoodNutrients({
        referenceGrams: 30,
        energyKcal: 400,
        proteinG: 0,
        carbG: 0,
        fatG: 0,
        fiberG: null,
      }),
    ).toThrow(/energia/i)
  })
})
