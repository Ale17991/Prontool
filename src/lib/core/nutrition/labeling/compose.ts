import type { FoodRef } from '../diet/totals'
import {
  FRONT_OF_PACK,
  FRONT_OF_PACK_NUTRIENTS,
  LABEL_NUTRIENTS,
  NORMATIVE_VERSION,
  type FrontOfPackNutrient,
  type LabelBasis,
  type LabelNutrientDef,
} from './reference'
import { declaredDvPercent, declaredValue } from './rounding'

/**
 * Feature 052 — composição da tabela nutricional. Puro e isomórfico: a mesma
 * função roda no cliente (tabela ao vivo) e no servidor (gravação e PDF).
 *
 * O que distingue este motor do de plano alimentar (`diet/totals.ts`): lá, um
 * micronutriente ausente simplesmente não entra na soma, e o total sai
 * subestimado com um aviso. Aqui isso seria declaração falsa numa embalagem —
 * então o nutriente inteiro fica INDEFINIDO e a tela diz quais ingredientes
 * faltaram. Com 7% de cobertura de açúcares adicionados na base, esse é o caso
 * comum, não a exceção.
 */

export type ValueState = 'calculado' | 'incompleto' | 'sobrescrito'
export type FrontOfPackVerdict = 'aplica' | 'nao_aplica' | 'inconclusivo'

export interface LabelIngredient {
  foodId: string
  name: string
  /** Quanto entra no preparo. */
  grams: number
  food: FoodRef
}

export interface LabelNutrientRow {
  key: string
  label: string
  unit: 'kcal' | 'g' | 'mg'
  /** Por 100 g (sólido) ou 100 mL (líquido). `null` = desconhecido. */
  per100: number | null
  perPortion: number | null
  /** `null` quando a norma não estabelece VDR ou o valor é desconhecido. */
  dvPercent: number | null
  state: ValueState
  /** Ingredientes sem o dado — preenchido só quando `state = 'incompleto'`. */
  missingFrom: string[]
}

export interface LabelResult {
  rows: LabelNutrientRow[]
  frontOfPack: Record<FrontOfPackNutrient, FrontOfPackVerdict>
  /** Algum nutriente obrigatório indefinido → não pode ir para embalagem. */
  incomplete: boolean
  normativeVersion: string
}

export interface ComposeArgs {
  ingredients: readonly LabelIngredient[]
  /** Rendimento total do preparo — INFORMADO, nunca deduzido da soma. */
  totalYield: number
  portionSize: number
  basis: LabelBasis
  /**
   * Sobrescritas manuais, por 100 g/mL. Valor numérico define; `null` ou
   * ausente significa "sem sobrescrita".
   */
  manualValues?: Readonly<Record<string, number | null | undefined>>
}

/**
 * Extrai o aporte de um nutriente num alimento, já escalado para os gramas do
 * preparo. Devolve `null` quando o alimento NÃO TEM o dado — que é diferente de
 * ter zero.
 */
function contribution(nutrient: LabelNutrientDef, ing: LabelIngredient): number | null {
  const ref = ing.food.referenceGrams
  if (!Number.isFinite(ref) || ref <= 0) return null
  const factor = ing.grams / ref

  if (nutrient.source.kind === 'field') {
    const raw = ing.food[nutrient.source.field]
    if (raw === null || raw === undefined || !Number.isFinite(raw)) return null
    return raw * factor
  }

  const micros = ing.food.micros
  if (!micros) return null
  const raw = micros[nutrient.source.key]
  // Chave ausente = alimento sem o dado. Nunca tratar como zero.
  if (raw === undefined || raw === null || !Number.isFinite(raw)) return null
  return raw * factor
}

interface RawTotal {
  /** Total do preparo inteiro. `null` = indefinido. */
  total: number | null
  missingFrom: string[]
}

function sumNutrient(
  nutrient: LabelNutrientDef,
  ingredients: readonly LabelIngredient[],
): RawTotal {
  let total = 0
  const missingFrom: string[] = []
  for (const ing of ingredients) {
    const c = contribution(nutrient, ing)
    if (c === null) missingFrom.push(ing.name)
    else total += c
  }
  // Um único ingrediente sem o dado já torna o TOTAL indefinido: somar só o que
  // se conhece produziria um número menor que o real, e subdeclarar num rótulo
  // é pior que não declarar.
  return missingFrom.length > 0 ? { total: null, missingFrom } : { total, missingFrom: [] }
}

export function composeLabel(args: ComposeArgs): LabelResult {
  const { ingredients, totalYield, portionSize, basis } = args
  const manual = args.manualValues ?? {}
  const yieldOk = Number.isFinite(totalYield) && totalYield > 0

  const rows: LabelNutrientRow[] = []

  for (const nutrient of [...LABEL_NUTRIENTS].sort((a, b) => a.order - b.order)) {
    const override = manual[nutrient.key]
    const hasOverride = typeof override === 'number' && Number.isFinite(override)

    let per100Raw: number | null
    let perPortionRaw: number | null
    let state: ValueState
    let missingFrom: string[] = []

    if (hasOverride) {
      // A sobrescrita é informada POR 100 g/mL — é assim que o rótulo é lido.
      per100Raw = override
      perPortionRaw = (override / 100) * portionSize
      state = 'sobrescrito'
    } else {
      const { total, missingFrom: missing } = sumNutrient(nutrient, ingredients)
      if (total === null || !yieldOk) {
        per100Raw = null
        perPortionRaw = null
        state = 'incompleto'
        missingFrom = missing
      } else {
        per100Raw = (total / totalYield) * 100
        perPortionRaw = (total / totalYield) * portionSize
        state = 'calculado'
      }
    }

    const per100 = declaredValue(per100Raw, nutrient)
    const perPortion = declaredValue(perPortionRaw, nutrient)

    rows.push({
      key: nutrient.key,
      label: nutrient.label,
      unit: nutrient.unit,
      per100,
      perPortion,
      dvPercent: declaredDvPercent(perPortion, nutrient),
      state,
      missingFrom,
    })
  }

  const byKey = new Map(rows.map((r) => [r.key, r]))

  const frontOfPack = {} as Record<FrontOfPackNutrient, FrontOfPackVerdict>
  for (const key of FRONT_OF_PACK_NUTRIENTS) {
    const row = byKey.get(key)
    // Sem o dado, NÃO se conclui que o produto está liberado — é o erro mais
    // caro possível aqui, porque põe produto irregular na prateleira.
    if (!row || row.per100 === null) {
      frontOfPack[key] = 'inconclusivo'
      continue
    }
    const limit = FRONT_OF_PACK[key][basis]
    // Compara o valor DECLARADO (já arredondado) para que a marca frontal nunca
    // contradiga o número impresso na tabela ao lado.
    frontOfPack[key] = row.per100 >= limit ? 'aplica' : 'nao_aplica'
  }

  return {
    rows,
    frontOfPack,
    incomplete: rows.some((r) => r.state === 'incompleto'),
    normativeVersion: NORMATIVE_VERSION,
  }
}
