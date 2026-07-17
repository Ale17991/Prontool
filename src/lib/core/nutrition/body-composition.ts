/**
 * Feature 046 — composição corporal: dobras cutâneas → densidade → % de
 * gordura (Siri) → massa gorda/magra; IMC e RCQ com classificação.
 *
 * Coeficientes replicados de `nutri-doc/formulas-referencia.md` (planilhas
 * de referência). Puro e isomórfico. Excel `LOG()` = log base 10.
 */

import { log10, round, type Sex } from './age-sex'
import { classifyImc, classifyWaistHip } from './classify'
import {
  DOBRA_PROTOCOLS,
  type CircumferenceSite,
  type DobraProtocol,
  type SkinfoldSite,
} from './protocols'

export class NutritionInputError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'NutritionInputError'
  }
}

export interface CompositionInput {
  sex: Sex
  ageYears: number
  weightKg: number
  heightCm?: number | null
  protocol: DobraProtocol
  skinfolds?: Partial<Record<SkinfoldSite, number>>
  circumferences?: Partial<Record<CircumferenceSite, number>>
  /** Só quando protocol = 'bioimpedancia': %gordura direto do aparelho. */
  fatPctInput?: number | null
}

export interface CompositionResult {
  bodyDensity: number | null
  fatPct: number
  fatMassKg: number
  leanMassKg: number
  imc: number | null
  imcClass: string | null
  waistHipRatio: number | null
  waistHipClass: string | null
}

/** Siri (1961): Dc → % de gordura. */
export function siri(dc: number): number {
  return 495 / dc - 450
}

function requireSites(
  input: CompositionInput,
  sites: SkinfoldSite[],
): Record<SkinfoldSite, number> {
  const sf = input.skinfolds ?? {}
  const out = {} as Record<SkinfoldSite, number>
  const missing: SkinfoldSite[] = []
  for (const s of sites) {
    const v = sf[s]
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) missing.push(s)
    else out[s] = v
  }
  if (missing.length > 0) {
    throw new NutritionInputError(
      'MISSING_SKINFOLDS',
      `Dobras faltando para o protocolo: ${missing.join(', ')}`,
    )
  }
  return out
}

function sum(vals: number[]): number {
  return vals.reduce((s, v) => s + v, 0)
}

/** Densidade corporal por protocolo (protocolos baseados em densidade). */
function bodyDensity(input: CompositionInput): number {
  const { sex, ageYears: I } = input
  const meta = DOBRA_PROTOCOLS[input.protocol]
  const sf = requireSites(input, meta.sites[sex])
  const S = sum(meta.sites[sex].map((s) => sf[s]))

  switch (input.protocol) {
    case 'durnin_womersley':
      return sex === 'M' ? 1.1765 - 0.0744 * log10(S) : 1.1567 - 0.0717 * log10(S)
    case 'guedes':
      return sex === 'M' ? 1.17136 - 0.06706 * log10(S) : 1.1665 - 0.07063 * log10(S)
    case 'jp3':
      return sex === 'M'
        ? 1.10938 - 0.0008267 * S + 0.0000016 * S * S - 0.0002574 * I
        : 1.0994921 - 0.0009929 * S + 0.0000023 * S * S - 0.0001392 * I
    case 'jp7':
      return sex === 'M'
        ? 1.112 - 0.00043499 * S + 0.00000055 * S * S - 0.00028826 * I
        : 1.097 - 0.00046971 * S + 0.00000056 * S * S - 0.00012828 * I
    case 'petroski':
      // Mesmos coeficientes para ambos os sexos (mudam os sítios, via meta).
      return 1.1954713 - 0.07513507 * log10(S) - 0.00041072 * I
    case 'mcardle': {
      const tri = sf.triceps
      const sub = sf.subescapular
      if (ageYears12(I)) {
        return sex === 'M'
          ? 1.108 - 0.027 * log10(tri) - 0.038 * log10(sub)
          : 1.088 - 0.014 * log10(tri) - 0.036 * log10(sub)
      }
      return sex === 'M'
        ? 1.13 - 0.055 * log10(tri) - 0.026 * log10(sub)
        : 1.114 - 0.031 * log10(tri) - 0.041 * log10(sub)
    }
    default:
      throw new NutritionInputError('PROTOCOL_NOT_DENSITY', `Protocolo ${input.protocol} não usa densidade`)
  }
}

function ageYears12(age: number): boolean {
  return age <= 12
}

/** % de gordura por protocolo (resolve densidade→Siri OU fórmula direta). */
function fatPercent(input: CompositionInput): { fatPct: number; density: number | null } {
  const { sex, weightKg: P, heightCm } = input

  switch (input.protocol) {
    case 'bioimpedancia': {
      const v = input.fatPctInput
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new NutritionInputError('MISSING_FAT_PCT', 'Informe o % de gordura da bioimpedância.')
      }
      return { fatPct: v, density: null }
    }
    case 'faulkner': {
      const sf = requireSites(input, DOBRA_PROTOCOLS.faulkner.sites[sex])
      const S = sum(DOBRA_PROTOCOLS.faulkner.sites[sex].map((s) => sf[s]))
      return { fatPct: S * 0.153 + 5.783, density: null }
    }
    case 'weltman': {
      const cw = input.circumferences?.abdomen
      if (typeof cw !== 'number' || !Number.isFinite(cw) || cw <= 0) {
        throw new NutritionInputError('MISSING_CIRCUMFERENCE', 'Informe a circunferência abdominal (Weltman).')
      }
      if (sex === 'M') return { fatPct: 0.31457 * cw - 0.10969 * P + 10.8336, density: null }
      if (typeof heightCm !== 'number') {
        throw new NutritionInputError('MISSING_HEIGHT', 'Weltman (feminino) exige altura.')
      }
      return { fatPct: 0.11077 * cw - 0.17666 * heightCm + 0.14354 * P + 51.03301, density: null }
    }
    case 'slaughter': {
      const sf = requireSites(input, DOBRA_PROTOCOLS.slaughter.sites[sex])
      const S = sf.triceps + sf.subescapular
      if (sex === 'F') {
        const fatPct = S > 35 ? 0.546 * S + 9.7 : 1.33 * S - 0.013 * S * S - 2.5
        return { fatPct, density: null }
      }
      // Masculino: Σ > 35 tem fórmula fechada; ≤ 35 depende do estágio de
      // maturação (média branca/negra). Aproximação por faixa etária pendente
      // de extração completa das constantes (ver formulas-referencia.md B9).
      if (S > 35) return { fatPct: 0.783 * S + 1.6, density: null }
      const C = input.ageYears <= 12 ? -2.6 : input.ageYears <= 14 ? -3.4 : -5.5
      return { fatPct: 1.21 * S - 0.008 * S * S + C, density: null }
    }
    default: {
      const dc = bodyDensity(input)
      return { fatPct: siri(dc), density: dc }
    }
  }
}

/**
 * Composição corporal completa. Lança `NutritionInputError` com código quando
 * faltam entradas exigidas pelo protocolo.
 */
export function computeComposition(input: CompositionInput): CompositionResult {
  const { fatPct, density } = fatPercent(input)
  const P = input.weightKg
  const fatMassKg = (P * fatPct) / 100
  const leanMassKg = P - fatMassKg

  let imc: number | null = null
  let imcClass: string | null = null
  if (typeof input.heightCm === 'number' && input.heightCm > 0) {
    const h = input.heightCm / 100
    imc = P / (h * h)
    imcClass = classifyImc(imc, input.ageYears)
  }

  let waistHipRatio: number | null = null
  let waistHipClass: string | null = null
  const cintura = input.circumferences?.cintura
  const quadril = input.circumferences?.quadril
  if (typeof cintura === 'number' && typeof quadril === 'number' && quadril > 0) {
    waistHipRatio = round(cintura / quadril, 2)
    waistHipClass = classifyWaistHip(waistHipRatio, input.sex, input.ageYears)
  }

  return {
    bodyDensity: density === null ? null : round(density, 5),
    fatPct: round(fatPct, 2),
    fatMassKg: round(fatMassKg, 2),
    leanMassKg: round(leanMassKg, 2),
    imc: imc === null ? null : round(imc, 2),
    imcClass,
    waistHipRatio,
    waistHipClass,
  }
}
