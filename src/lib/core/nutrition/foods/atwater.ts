/**
 * Feature 047 — cálculo de Atwater e validação de plausibilidade de alimento.
 *
 * Puro e isomórfico (sem dependência de banco): usado no servidor ao cadastrar
 * alimento próprio e no cliente para preview. Espelha os CHECKs da migration
 * 0176 — a validação aqui dá mensagem clara antes do 23514 do banco.
 */

/** Fatores de Atwater (kcal por grama de macronutriente). */
export const ATWATER = { protein: 4, carb: 4, fat: 9 } as const

/** Energia (kcal) a partir dos macros — usado quando o alimento não a informa. */
export function energyFromMacros(proteinG: number, carbG: number, fatG: number): number {
  return ATWATER.protein * proteinG + ATWATER.carb * carbG + ATWATER.fat * fatG
}

export interface FoodNutrients {
  referenceGrams: number
  energyKcal: number | null
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number | null
}

export interface NormalizedNutrients {
  referenceGrams: number
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number | null
}

export class FoodInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'FoodInputError'
  }
}

/**
 * Valida e normaliza os nutrientes de um alimento por porção de referência.
 * Deriva a energia por Atwater quando ausente (FR-007). As faixas são
 * anti-erro-de-digitação (por porção de referência, padrão 100 g), não
 * julgamento nutricional — batem com os CHECKs da 0176.
 */
export function normalizeFoodNutrients(input: FoodNutrients): NormalizedNutrients {
  const { referenceGrams, proteinG, carbG, fatG, fiberG } = input

  if (!Number.isFinite(referenceGrams) || referenceGrams <= 0) {
    throw new FoodInputError('INVALID_REFERENCE', 'A porção de referência deve ser maior que zero.')
  }
  for (const [label, v] of [
    ['proteína', proteinG],
    ['carboidrato', carbG],
    ['lipídio', fatG],
  ] as const) {
    if (!Number.isFinite(v) || v < 0 || v > referenceGrams) {
      throw new FoodInputError(
        'MACRO_OUT_OF_RANGE',
        `Valor de ${label} implausível para ${referenceGrams} g (0 a ${referenceGrams} g).`,
      )
    }
  }
  if (fiberG !== null && (!Number.isFinite(fiberG) || fiberG < 0 || fiberG > referenceGrams)) {
    throw new FoodInputError('FIBER_OUT_OF_RANGE', `Fibra implausível para ${referenceGrams} g.`)
  }

  const energyKcal =
    input.energyKcal !== null && Number.isFinite(input.energyKcal)
      ? input.energyKcal
      : energyFromMacros(proteinG, carbG, fatG)

  // Teto proporcional à porção: óleo puro ≈ 884 kcal/100 g → 8,84 kcal/g.
  const maxEnergy = 10 * referenceGrams
  if (energyKcal < 0 || energyKcal > maxEnergy) {
    throw new FoodInputError(
      'ENERGY_OUT_OF_RANGE',
      `Energia implausível para ${referenceGrams} g (0 a ${maxEnergy} kcal).`,
    )
  }

  const r2 = (v: number) => Math.round(v * 100) / 100
  return {
    referenceGrams: r2(referenceGrams),
    energyKcal: r2(energyKcal),
    proteinG: r2(proteinG),
    carbG: r2(carbG),
    fatG: r2(fatG),
    fiberG: fiberG === null ? null : r2(fiberG),
  }
}
