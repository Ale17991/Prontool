/**
 * Feature 047 — motor de soma do plano alimentar (puro, isomórfico).
 *
 * Roda no cliente para o total ao vivo e no servidor para congelar a
 * prescrição — a MESMA função, para o número da tela nunca divergir do que é
 * gravado. Tudo por regra de três sobre a porção de referência do alimento.
 *
 * Arredondamento: mantemos precisão cheia na soma e arredondamos só na
 * apresentação/gravação final — somar valores já arredondados acumula erro e
 * quebraria o SC-002 ("números batendo").
 */

export interface Nutrients {
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number
}

/** Referência nutricional de um alimento (por `referenceGrams`). */
export interface FoodRef {
  referenceGrams: number
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number | null
}

export interface PlanItemInput {
  grams: number
  food: FoodRef
}

export interface MealInput {
  items: PlanItemInput[]
}

export interface Macros {
  protG: number
  carbG: number
  fatG: number
}

export const ZERO: Nutrients = { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 }

/** Nutrientes de um item: regra de três sobre a porção de referência. */
export function itemNutrients(item: PlanItemInput): Nutrients {
  const { grams, food } = item
  const factor = food.referenceGrams > 0 ? grams / food.referenceGrams : 0
  return {
    energyKcal: food.energyKcal * factor,
    proteinG: food.proteinG * factor,
    carbG: food.carbG * factor,
    fatG: food.fatG * factor,
    fiberG: (food.fiberG ?? 0) * factor,
  }
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  return {
    energyKcal: a.energyKcal + b.energyKcal,
    proteinG: a.proteinG + b.proteinG,
    carbG: a.carbG + b.carbG,
    fatG: a.fatG + b.fatG,
    fiberG: a.fiberG + b.fiberG,
  }
}

export function mealTotals(meal: MealInput): Nutrients {
  return meal.items.map(itemNutrients).reduce(addNutrients, ZERO)
}

export function dayTotals(meals: MealInput[]): Nutrients {
  return meals.map(mealTotals).reduce(addNutrients, ZERO)
}

/** Converte medida caseira → gramas (FR-012). */
export function measureToGrams(measureQty: number, measureGrams: number): number {
  return measureQty * measureGrams
}

export interface TargetDelta {
  kcal: number
  protG: number
  carbG: number
  fatG: number
}

/**
 * Diferença entre o total do plano e a meta (plano − meta). Positivo = acima
 * da meta; negativo = abaixo. `null` quando não há meta definida.
 */
export function targetDelta(
  total: Nutrients,
  target: { kcal: number | null; macros: Macros | null } | null,
): TargetDelta | null {
  if (!target || target.kcal === null) return null
  const m = target.macros
  return {
    kcal: total.energyKcal - target.kcal,
    protG: m ? total.proteinG - m.protG : 0,
    carbG: m ? total.carbG - m.carbG : 0,
    fatG: m ? total.fatG - m.fatG : 0,
  }
}

/** Arredonda em 2 casas — só na fronteira (apresentação/gravação). */
export function roundNutrients(n: Nutrients): Nutrients {
  const r = (v: number) => Math.round(v * 100) / 100
  return {
    energyKcal: r(n.energyKcal),
    proteinG: r(n.proteinG),
    carbG: r(n.carbG),
    fatG: r(n.fatG),
    fiberG: r(n.fiberG),
  }
}
