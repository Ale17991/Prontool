/**
 * T024 (Feature 047 US2) — motor de soma do plano alimentar (SC-002).
 */
import { describe, expect, it } from 'vitest'
import {
  itemNutrients,
  mealTotals,
  dayTotals,
  measureToGrams,
  targetDelta,
  roundNutrients,
  groupNutrients,
  type FoodRef,
} from '@/lib/core/nutrition/diet/totals'

const arrozIntegral: FoodRef = {
  referenceGrams: 100,
  energyKcal: 124,
  proteinG: 2.6,
  carbG: 25.8,
  fatG: 1,
  fiberG: 2.7,
}
const frango: FoodRef = {
  referenceGrams: 100,
  energyKcal: 163,
  proteinG: 31,
  carbG: 0,
  fatG: 3.6,
  fiberG: null,
}

describe('itemNutrients — regra de três sobre a porção de referência', () => {
  it('150 g de arroz integral (ref 100 g)', () => {
    const n = itemNutrients({ grams: 150, food: arrozIntegral })
    expect(n.energyKcal).toBeCloseTo(186, 6)
    expect(n.proteinG).toBeCloseTo(3.9, 6)
    expect(n.carbG).toBeCloseTo(38.7, 6)
  })

  it('porção de referência diferente de 100 g', () => {
    const whey: FoodRef = {
      referenceGrams: 30,
      energyKcal: 120,
      proteinG: 24,
      carbG: 3,
      fatG: 1.5,
      fiberG: 0,
    }
    const n = itemNutrients({ grams: 60, food: whey })
    expect(n.energyKcal).toBeCloseTo(240, 6)
    expect(n.proteinG).toBeCloseTo(48, 6)
  })

  it('fibra ausente conta como 0', () => {
    const n = itemNutrients({ grams: 200, food: frango })
    expect(n.fiberG).toBe(0)
  })
})

describe('mealTotals / dayTotals — soma bate exatamente (SC-002)', () => {
  const meal1 = {
    items: [
      { grams: 150, food: arrozIntegral },
      { grams: 120, food: frango },
    ],
  }
  const meal2 = { items: [{ grams: 100, food: arrozIntegral }] }

  it('total da refeição = soma dos itens', () => {
    const t = mealTotals(meal1)
    // arroz 150g: 186 kcal, 3.9 P, 38.7 C ; frango 120g: 195.6 kcal, 37.2 P, 0 C
    expect(t.energyKcal).toBeCloseTo(381.6, 6)
    expect(t.proteinG).toBeCloseTo(41.1, 6)
    expect(t.carbG).toBeCloseTo(38.7, 6)
  })

  it('total do dia = soma das refeições', () => {
    const t = dayTotals([meal1, meal2])
    // + arroz 100g: 124 kcal, 2.6 P, 25.8 C
    expect(t.energyKcal).toBeCloseTo(505.6, 6)
    expect(t.proteinG).toBeCloseTo(43.7, 6)
    expect(t.carbG).toBeCloseTo(64.5, 6)
  })

  it('dia vazio = zero', () => {
    expect(dayTotals([]).energyKcal).toBe(0)
    expect(dayTotals([{ items: [] }]).energyKcal).toBe(0)
  })
})

describe('groupNutrients — grupo (lista OU) conta como 1 porção por reference_kcal', () => {
  // Dois itens porcionados p/ ~80 kcal cada: arroz integral 65g (~80.6 kcal),
  // batata 100g (fictícia 80 kcal).
  const arroz: FoodRef = {
    referenceGrams: 100,
    energyKcal: 124,
    proteinG: 2.6,
    carbG: 25.8,
    fatG: 1,
    fiberG: 2.7,
  }
  const batata: FoodRef = {
    referenceGrams: 100,
    energyKcal: 80,
    proteinG: 2,
    carbG: 18,
    fatG: 0,
    fiberG: 1.5,
  }

  it('energia = reference_kcal quando definida; macros proporcionais', () => {
    const n = groupNutrients({
      referenceKcal: 80,
      items: [
        { grams: 65, food: arroz },
        { grams: 100, food: batata },
      ],
    })
    expect(n.energyKcal).toBe(80)
    // macros > 0 e coerentes com carboidrato dominante
    expect(n.carbG).toBeGreaterThan(0)
    expect(n.proteinG).toBeGreaterThan(0)
  })

  it('sem reference_kcal → usa a média de energia dos itens', () => {
    const n = groupNutrients({
      referenceKcal: null,
      items: [
        { grams: 100, food: arroz }, // 124 kcal
        { grams: 100, food: batata }, // 80 kcal
      ],
    })
    expect(n.energyKcal).toBeCloseTo(102, 6) // (124 + 80) / 2
  })

  it('grupo vazio → energia = reference_kcal, macros zero', () => {
    const n = groupNutrients({ referenceKcal: 80, items: [] })
    expect(n.energyKcal).toBe(80)
    expect(n.proteinG).toBe(0)
    expect(n.carbG).toBe(0)
  })
})

describe('micronutrientes na soma (049 US1)', () => {
  const arrozMicro: FoodRef = {
    referenceGrams: 100,
    energyKcal: 124,
    proteinG: 2.6,
    carbG: 25.8,
    fatG: 1,
    fiberG: 2.7,
    micros: { ferro_mg: 0.3, calcio_mg: 4 },
  }
  const feijaoMicro: FoodRef = {
    referenceGrams: 100,
    energyKcal: 76,
    proteinG: 4.8,
    carbG: 13.6,
    fatG: 0.5,
    fiberG: 8.5,
    micros: { ferro_mg: 1.3, potassio_mg: 255 }, // sem calcio
  }

  it('itemNutrients escala os micros por regra de três', () => {
    const n = itemNutrients({ grams: 200, food: arrozMicro })
    expect(n.micros!.ferro_mg).toBeCloseTo(0.6, 6)
    expect(n.micros!.calcio_mg).toBeCloseTo(8, 6)
  })

  it('a soma acumula micros; chave ausente num item não vira zero forçado', () => {
    const t = mealTotals({
      items: [
        { grams: 100, food: arrozMicro },
        { grams: 100, food: feijaoMicro },
      ],
    })
    // ferro presente nos dois: 0.3 + 1.3
    expect(t.micros!.ferro_mg).toBeCloseTo(1.6, 6)
    // calcio só no arroz; potassio só no feijão — cada um acumula o que tem
    expect(t.micros!.calcio_mg).toBeCloseTo(4, 6)
    expect(t.micros!.potassio_mg).toBeCloseTo(255, 6)
  })

  it('alimento sem micros não adiciona chaves', () => {
    const semMicro: FoodRef = {
      referenceGrams: 100,
      energyKcal: 100,
      proteinG: 0,
      carbG: 25,
      fatG: 0,
      fiberG: 0,
    }
    const n = itemNutrients({ grams: 50, food: semMicro })
    expect(n.micros).toBeUndefined()
  })
})

describe('measureToGrams (FR-012)', () => {
  it('2 fatias de 25 g = 50 g', () => {
    expect(measureToGrams(2, 25)).toBe(50)
  })
})

describe('targetDelta — comparação com a meta (FR-011)', () => {
  const total = { energyKcal: 1800, proteinG: 120, carbG: 200, fatG: 60, fiberG: 25 }

  it('delta = plano − meta', () => {
    const d = targetDelta(total, { kcal: 2200, macros: { protG: 165, carbG: 220, fatG: 73 } })
    expect(d).not.toBeNull()
    expect(d!.kcal).toBe(-400)
    expect(d!.protG).toBe(-45)
    expect(d!.carbG).toBe(-20)
    expect(d!.fatG).toBe(-13)
  })

  it('sem meta → null (plano funciona sem avaliação)', () => {
    expect(targetDelta(total, null)).toBeNull()
    expect(targetDelta(total, { kcal: null, macros: null })).toBeNull()
  })
})

describe('roundNutrients — arredonda só na fronteira', () => {
  it('2 casas', () => {
    const r = roundNutrients({
      energyKcal: 186.00001,
      proteinG: 3.899,
      carbG: 38.7,
      fatG: 1.5,
      fiberG: 4.05,
    })
    expect(r.energyKcal).toBe(186)
    expect(r.proteinG).toBe(3.9)
  })
})
