/**
 * Feature 046 — gasto energético: TMB por equação → GET (atividade/injúria/
 * gestação) → VET-meta (objetivo) → macronutrientes.
 *
 * Coeficientes de `nutri-doc/formulas-referencia.md`. Onde a planilha divergia
 * claramente do publicado, usam-se os **valores canônicos** (decisão do
 * usuário): Mifflin 10/6.25/5; Harris-Benedict com precisão cheia; EER/IOM 2005
 * na forma canônica NASEM/IOM (PA multiplicando peso+altura, sem aditivos extra
 * que apareciam na planilha). Puro e isomórfico.
 */

import type { Sex } from './age-sex'
import { NutritionInputError } from './body-composition'
import type { TmbEquation } from './protocols'

export interface EnergyInput {
  sex: Sex
  ageYears: number
  weightKg: number
  heightCm?: number | null
  /** Massa livre de gordura (kg) — exigida por Katch-McArdle/Cunningham/Tinsley-MLG. */
  leanMassKg?: number | null
  equation: TmbEquation
  /** PAL clássico (1.2–1.9) para equações não-EER. */
  activityFactor?: number | null
  /** Fator injúria/estresse (médio). Default 1.0. */
  injuryFactor?: number | null
  /** Adicional calórico manual (kcal). */
  extraKcal?: number | null
  /** PA multiplicativo da EER/IOM 2005 (sedentário 1.0 … muito ativo ~1.48). */
  eerPa?: number | null
  /** Categoria de atividade 1–4 da EER 2023/gestante/lactante. */
  eerCategory?: 1 | 2 | 3 | 4 | null
  /** Semanas de gestação (EER Gestante). */
  pregnancyWeeks?: number | null
  /** Depósito energético da gestação (kcal) — entrada específica; default 0. */
  pregnancyDepositKcal?: number | null
  objective?: 'deficit' | 'manutencao' | 'superavit' | null
  /** Ajuste em kcal sobre o GET (sinal conforme objetivo). */
  objectiveDeltaKcal?: number | null
  macros?: {
    protPct?: number
    carbPct?: number
    lipPct?: number
    protGkg?: number
    carbGkg?: number
    lipGkg?: number
  } | null
}

export interface MacroResult {
  protG: number
  carbG: number
  lipG: number
  protKcal: number
  carbKcal: number
  lipKcal: number
}

export interface EnergyResult {
  /** TMB (equações clássicas) OU o valor EER (que já é total). */
  tmbKcal: number
  getKcal: number
  targetKcal: number | null
  macros: MacroResult | null
}

const r0 = (x: number): number => Math.round(x)

function requireLean(input: EnergyInput): number {
  const mlg = input.leanMassKg
  if (typeof mlg !== 'number' || !Number.isFinite(mlg) || mlg <= 0) {
    throw new NutritionInputError(
      'MISSING_LEAN_MASS',
      'Esta equação usa massa magra — preencha a composição corporal primeiro.',
    )
  }
  return mlg
}

function requireHeight(input: EnergyInput): number {
  const a = input.heightCm
  if (typeof a !== 'number' || !Number.isFinite(a) || a <= 0) {
    throw new NutritionInputError('MISSING_HEIGHT', 'Esta equação exige altura.')
  }
  return a
}

/** Seleciona por faixa: `bands` ordenado por `maxAge` crescente. */
function byAge<T>(age: number, bands: { maxAge: number; v: T }[]): T {
  const b = bands.find((x) => age <= x.maxAge) ?? bands[bands.length - 1]!
  return b.v
}

/** Custo energético de crescimento (EER 2023, kcal). */
function growthCost(age: number, sex: Sex): number {
  if (age === 3) return sex === 'M' ? 20 : 15
  if (age >= 4 && age <= 8) return 15
  if (age >= 9 && age <= 13) return sex === 'M' ? 25 : 30
  if (age >= 14 && age <= 18) return 20
  return 0
}

const EER2023_CHILD: Record<Sex, [number, number, number][]> = {
  // por categoria 1..4: [intercepto, coefA(cm), coefP]; termo de idade fixo abaixo
  M: [
    [-447.51, 13.01, 13.15],
    [19.12, 8.62, 20.28],
    [-388.19, 12.66, 20.46],
    [-671.75, 15.38, 23.25],
  ],
  F: [
    [55.59, 8.43, 17.07],
    [-297.54, 12.77, 14.73],
    [-189.55, 11.74, 18.34],
    [-709.59, 18.22, 14.25],
  ],
}
const EER2023_CHILD_AGE: Record<Sex, number> = { M: 3.68, F: -22.25 }

const EER2023_ADULT: Record<Sex, [number, number, number][]> = {
  M: [
    [753.07, 6.5, 14.1],
    [581.47, 8.3, 14.94],
    [1004.82, 6.52, 15.91],
    [-517.88, 15.61, 19.11],
  ],
  F: [
    [584.9, 5.72, 11.71],
    [575.77, 6.6, 12.14],
    [710.25, 6.54, 12.34],
    [511.83, 9.07, 12.56],
  ],
}
const EER2023_ADULT_AGE: Record<Sex, number> = { M: -10.83, F: -7.01 }

function eerCategoryIdx(input: EnergyInput): number {
  const c = input.eerCategory ?? 1
  return Math.min(4, Math.max(1, c)) - 1
}

/**
 * Coeficientes PA do EER/IOM 2005, por nível de atividade (sedentário, pouco
 * ativo, ativo, muito ativo).
 *
 * São QUATRO tabelas distintas: variam por sexo E entre adulto (≥19) e
 * pediátrico (3–18). Reusar a tabela adulta em criança (ou trocar M/F) é erro
 * silencioso — daí estarem separadas explicitamente.
 *
 * Fonte: IOM, DRI for Energy… (2005), cap. 5.
 */
const EER2005_PA = {
  adult: { M: [1.0, 1.11, 1.25, 1.48], F: [1.0, 1.12, 1.27, 1.45] },
  child: { M: [1.0, 1.13, 1.26, 1.42], F: [1.0, 1.16, 1.31, 1.56] },
} as const

/**
 * PA efetivo do EER/IOM 2005.
 *
 * Precedência: `eerPa` explícito (permite a nutricionista informar um PA
 * próprio) > tabela oficial pela categoria escolhida. Antes isto caía direto
 * em 1.0 quando só a categoria era informada — o EER saía sempre como
 * sedentário, subestimando ~560 kcal/dia num adulto ativo.
 */
function eer2005Pa(input: EnergyInput): number {
  if (typeof input.eerPa === 'number' && Number.isFinite(input.eerPa)) return input.eerPa
  const table = input.ageYears >= 19 ? EER2005_PA.adult : EER2005_PA.child
  return table[input.sex][eerCategoryIdx(input)] ?? 1.0
}

/** EER 2023 base (sem adicionais de lactação). Já é o gasto total. */
function eer2023(input: EnergyInput): number {
  const { sex, ageYears: I, weightKg: P } = input
  const A = requireHeight(input)
  const idx = eerCategoryIdx(input)
  if (I >= 19) {
    const [k, ca, cp] = EER2023_ADULT[sex][idx]!
    return k + EER2023_ADULT_AGE[sex] * I + ca * A + cp * P
  }
  const [k, ca, cp] = EER2023_CHILD[sex][idx]!
  return k + EER2023_CHILD_AGE[sex] * I + ca * A + cp * P + growthCost(I, sex)
}

/** EER/IOM 2005 (forma canônica NASEM/IOM). Altura em metros. Já é total. */
function eer2005(input: EnergyInput): number {
  const { sex, ageYears: I, weightKg: P } = input
  const hM = requireHeight(input) / 100
  const pa = eer2005Pa(input)
  if (I >= 19) {
    return sex === 'M'
      ? 662 - 9.53 * I + pa * (15.91 * P + 539.6 * hM)
      : 354 - 6.91 * I + pa * (9.36 * P + 726 * hM)
  }
  const deposition = I >= 9 ? 25 : 20
  return sex === 'M'
    ? 88.5 - 61.9 * I + pa * (26.7 * P + 903 * hM) + deposition
    : 135.3 - 30.8 * I + pa * (10 * P + 934 * hM) + deposition
}

/** Basal (não-EER) ou o valor EER (já total). */
export function computeTmb(input: EnergyInput): number {
  const { sex, ageYears: I, weightKg: P } = input
  const male = sex === 'M'

  switch (input.equation) {
    case 'harris_benedict_1919':
      return male
        ? 66.473 + 13.7516 * P + 5.0033 * requireHeight(input) - 6.755 * I
        : 655.0955 + 9.5634 * P + 1.8496 * requireHeight(input) - 4.6756 * I
    case 'harris_benedict_1984':
      return male
        ? 88.362 + 13.397 * P + 4.799 * requireHeight(input) - 5.677 * I
        : 447.593 + 9.247 * P + 3.098 * requireHeight(input) - 4.33 * I
    case 'mifflin':
      return 10 * P + 6.25 * requireHeight(input) - 5 * I + (male ? 5 : -161)
    case 'fao_who_1985':
      return male
        ? byAge(I, [
            { maxAge: 2, v: 60.9 * P - 54 },
            { maxAge: 9, v: 22.7 * P + 495 },
            { maxAge: 17, v: 17.5 * P + 651 },
            { maxAge: 29, v: 15.3 * P + 679 },
            { maxAge: 59, v: 11.6 * P + 879 },
            { maxAge: 200, v: 13.5 * P + 487 },
          ])
        : byAge(I, [
            { maxAge: 2, v: 61 * P - 51 },
            { maxAge: 9, v: 22.5 * P + 499 },
            { maxAge: 17, v: 12.2 * P + 746 },
            { maxAge: 29, v: 14.7 * P + 496 },
            { maxAge: 59, v: 8.7 * P + 829 },
            { maxAge: 200, v: 10.5 * P + 596 },
          ])
    case 'fao_who_2004':
      return male
        ? byAge(I, [
            { maxAge: 2, v: 59.512 * P - 30.4 },
            { maxAge: 9, v: 22.706 * P + 504.3 },
            { maxAge: 17, v: 17.686 * P + 658.2 },
            { maxAge: 29, v: 15.057 * P + 692.2 },
            { maxAge: 59, v: 11.472 * P + 873.1 },
            { maxAge: 200, v: 11.711 * P + 587.7 },
          ])
        : byAge(I, [
            { maxAge: 2, v: 58.317 * P - 31.1 },
            { maxAge: 9, v: 20.315 * P + 485.9 },
            { maxAge: 17, v: 13.384 * P + 692.6 },
            { maxAge: 29, v: 14.818 * P + 486.6 },
            { maxAge: 59, v: 8.126 * P + 845.6 },
            { maxAge: 200, v: 9.082 * P + 658.5 },
          ])
    case 'schofield': {
      const A = requireHeight(input)
      return male
        ? byAge(I, [
            { maxAge: 2, v: 0.167 * P + 15.174 * A - 617.6 },
            { maxAge: 9, v: 19.59 * P + 1.303 * A + 414.9 },
            { maxAge: 17, v: 16.25 * P + 1.372 * A + 515.5 },
            { maxAge: 29, v: (0.063 * P + 2.896) * 239 },
            { maxAge: 59, v: (0.048 * P + 3.653) * 239 },
            { maxAge: 200, v: (0.049 * P + 2.459) * 239 },
          ])
        : byAge(I, [
            { maxAge: 2, v: 16.252 * P + 10.232 * A - 413.5 },
            { maxAge: 9, v: 16.969 * P + 1.618 * A + 371.2 },
            { maxAge: 17, v: 8.365 * P + 4.65 * A + 200 },
            { maxAge: 29, v: (0.062 * P + 2.036) * 239 },
            { maxAge: 59, v: (0.034 * P + 3.538) * 239 },
            { maxAge: 200, v: (0.038 * P + 2.755) * 239 },
          ])
    }
    case 'henry_rees':
      return male
        ? byAge(I, [
            { maxAge: 9, v: (0.113 * P + 1.689) * 239 },
            { maxAge: 17, v: (0.084 * P + 2.122) * 239 },
            { maxAge: 29, v: (0.056 * P + 2.8) * 239 },
            { maxAge: 200, v: (0.046 * P + 3.16) * 239 },
          ])
        : byAge(I, [
            { maxAge: 9, v: (0.063 * P + 2.466) * 239 },
            { maxAge: 17, v: (0.047 * P + 2.951) * 239 },
            { maxAge: 29, v: (0.048 * P + 2.562) * 239 },
            { maxAge: 200, v: (0.048 * P + 2.448) * 239 },
          ])
    case 'cunningham':
      return 500 + 22 * requireLean(input)
    case 'katch_mcardle':
      return 370 + 21.6 * requireLean(input)
    case 'tinsley_peso':
      return 24.8 * P + 10
    case 'tinsley_mlg':
      return 25.9 * requireLean(input) + 284
    case 'eer_iom_2005':
      return eer2005(input)
    case 'eer_2023':
      return eer2023(input)
    case 'eer_gestante': {
      const A = requireHeight(input)
      const idx = eerCategoryIdx(input)
      const gest: [number, number, number][] = [
        [1131.2, 0.34, 12.15],
        [693.35, 5.73, 10.2],
        [-223.84, 13.23, 8.15],
        [-779.72, 18.45, 8.73],
      ]
      const [k, ca, cp] = gest[idx]!
      const sem = input.pregnancyWeeks ?? 0
      const dep = input.pregnancyDepositKcal ?? 0
      return k - 2.04 * I + ca * A + cp * P + 9.16 * sem + dep
    }
    case 'eer_lactante_0_6':
      return eer2023(input) + 540 - 140
    case 'eer_lactante_7_12':
      return eer2023(input) + 380
    default:
      throw new NutritionInputError('UNKNOWN_EQUATION', `Equação desconhecida: ${input.equation}`)
  }
}

const EER_SET: ReadonlySet<TmbEquation> = new Set<TmbEquation>([
  'eer_iom_2005',
  'eer_2023',
  'eer_gestante',
  'eer_lactante_0_6',
  'eer_lactante_7_12',
])

/** GET: EER já é total; clássicas multiplicam por PAL × injúria e somam extra. */
export function computeGet(input: EnergyInput, tmb: number): number {
  const injury = input.injuryFactor ?? 1.0
  const extra = input.extraKcal ?? 0
  if (EER_SET.has(input.equation)) {
    return tmb * injury + extra
  }
  const pal = input.activityFactor ?? 1.0
  return tmb * pal * injury + extra
}

function computeMacros(targetKcal: number, input: EnergyInput): MacroResult | null {
  const m = input.macros
  if (!m) return null
  let protG: number, carbG: number, lipG: number
  if (m.protGkg !== undefined || m.carbGkg !== undefined || m.lipGkg !== undefined) {
    protG = (m.protGkg ?? 0) * input.weightKg
    carbG = (m.carbGkg ?? 0) * input.weightKg
    lipG = (m.lipGkg ?? 0) * input.weightKg
  } else {
    const sumPct = (m.protPct ?? 0) + (m.carbPct ?? 0) + (m.lipPct ?? 0)
    if (Math.round(sumPct) !== 100) {
      throw new NutritionInputError('MACROS_SUM_INVALID', 'Os percentuais de macros devem somar 100%.')
    }
    protG = (targetKcal * (m.protPct ?? 0)) / 100 / 4
    carbG = (targetKcal * (m.carbPct ?? 0)) / 100 / 4
    lipG = (targetKcal * (m.lipPct ?? 0)) / 100 / 9
  }
  return {
    protG: Math.round(protG),
    carbG: Math.round(carbG),
    lipG: Math.round(lipG),
    protKcal: r0(protG * 4),
    carbKcal: r0(carbG * 4),
    lipKcal: r0(lipG * 9),
  }
}

/** Cálculo energético completo. */
export function computeEnergy(input: EnergyInput): EnergyResult {
  if (TMB_FEMALE_ONLY.has(input.equation) && input.sex !== 'F') {
    throw new NutritionInputError('EQUATION_FEMALE_ONLY', 'Equação disponível apenas para mulheres.')
  }
  const tmb = computeTmb(input)
  const get = computeGet(input, tmb)
  const targetKcal = get + (input.objectiveDeltaKcal ?? 0)
  const macros = computeMacros(targetKcal, input)
  return {
    tmbKcal: r0(tmb),
    getKcal: r0(get),
    targetKcal: r0(targetKcal),
    macros,
  }
}

const TMB_FEMALE_ONLY: ReadonlySet<TmbEquation> = new Set<TmbEquation>([
  'eer_gestante',
  'eer_lactante_0_6',
  'eer_lactante_7_12',
])
