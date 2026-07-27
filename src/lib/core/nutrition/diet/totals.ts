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

import type { MicronutrientMap } from '../micronutrients'

export interface Nutrients {
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number
  /** Micronutrientes somados (chaves do catálogo). Opcional — ausência = sem dado. */
  micros?: MicronutrientMap
}

/** Referência nutricional de um alimento (por `referenceGrams`). */
export interface FoodRef {
  referenceGrams: number
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number | null
  /** Micronutrientes por porção de referência (chaves do catálogo). */
  micros?: MicronutrientMap | null
}

/** Escala um mapa de micros por um fator (regra de três). Ausente = {}. */
function scaleMicros(micros: MicronutrientMap | null | undefined, factor: number): MicronutrientMap | undefined {
  if (!micros) return undefined
  const out: MicronutrientMap = {}
  for (const [k, v] of Object.entries(micros)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v * factor
  }
  return Object.keys(out).length ? out : undefined
}

/** Soma dois mapas de micros; chave presente em qualquer lado é acumulada. */
function addMicros(
  a: MicronutrientMap | undefined,
  b: MicronutrientMap | undefined,
): MicronutrientMap | undefined {
  if (!a) return b
  if (!b) return a
  const out: MicronutrientMap = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v
  return out
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
    micros: scaleMicros(food.micros, factor),
  }
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  return {
    energyKcal: a.energyKcal + b.energyKcal,
    proteinG: a.proteinG + b.proteinG,
    carbG: a.carbG + b.carbG,
    fatG: a.fatG + b.fatG,
    fiberG: a.fiberG + b.fiberG,
    micros: addMicros(a.micros, b.micros),
  }
}

export function mealTotals(meal: MealInput): Nutrients {
  return meal.items.map(itemNutrients).reduce(addNutrients, ZERO)
}

/**
 * Um grupo (lista de substituição / "OU") adicionado a uma refeição conta como
 * UMA porção padronizada: `referenceGrams` não se aplica — a energia é a
 * `referenceKcal` da lista e os macros são proporcionais à composição média dos
 * seus itens. Cada item da lista já é porcionado (`grams`) para ser equivalente,
 * então a média dos itens representa bem "1 porção" do grupo; escalamos essa
 * média para bater exatamente com `referenceKcal` (quando definida).
 */
export interface GroupRef {
  referenceKcal: number | null
  items: PlanItemInput[]
}

export function groupNutrients(group: GroupRef): Nutrients {
  const n = group.items.length
  if (n === 0) return { ...ZERO, energyKcal: group.referenceKcal ?? 0 }
  const total = group.items.map(itemNutrients).reduce(addNutrients, ZERO)
  const avg: Nutrients = {
    energyKcal: total.energyKcal / n,
    proteinG: total.proteinG / n,
    carbG: total.carbG / n,
    fatG: total.fatG / n,
    fiberG: total.fiberG / n,
  }
  const targetKcal = group.referenceKcal ?? avg.energyKcal
  const factor = avg.energyKcal > 0 ? targetKcal / avg.energyKcal : 1
  return {
    energyKcal: targetKcal,
    proteinG: avg.proteinG * factor,
    carbG: avg.carbG * factor,
    fatG: avg.fatG * factor,
    fiberG: avg.fiberG * factor,
  }
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
  let micros: MicronutrientMap | undefined
  if (n.micros) {
    micros = {}
    for (const [k, v] of Object.entries(n.micros)) micros[k] = r(v)
  }
  return {
    energyKcal: r(n.energyKcal),
    proteinG: r(n.proteinG),
    carbG: r(n.carbG),
    fatG: r(n.fatG),
    fiberG: r(n.fiberG),
    micros,
  }
}
