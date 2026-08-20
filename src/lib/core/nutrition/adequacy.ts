import type { Nutrients } from './diet/totals'
import { MICRONUTRIENTS, micronutrientDef } from './micronutrients'
import type { DriValue } from './dri/read'

/**
 * Feature 049 US2 — análise de adequação: total (plano/recordatório) × DRI da
 * faixa do paciente, por nutriente, com % e classificação. Puro/isomórfico.
 * Faixa: <90% abaixo · 90–110% adequado · >110% acima (ajustável).
 */

export const ADEQUATE_MIN = 90
export const ADEQUATE_MAX = 110

export type AdequacyClass = 'abaixo' | 'adequado' | 'acima' | 'sem_referencia'

export interface AdequacyItem {
  nutrientKey: string
  label: string
  unit: string
  total: number
  dri: number | null
  pct: number | null
  class: AdequacyClass
}

export interface AdequacyResult {
  items: AdequacyItem[]
  deficits: number
  excesses: number
}

// driKey → chave do micro (para achar o total consumido em `micros`).
const DRIKEY_TO_MICRO = new Map(
  MICRONUTRIENTS.filter((m) => m.driKey).map((m) => [m.driKey as string, m.key]),
)

function consumed(nutrientKey: string, totals: Nutrients): number {
  if (nutrientKey === 'fibra') return totals.fiberG ?? 0
  const microKey = DRIKEY_TO_MICRO.get(nutrientKey)
  if (microKey && totals.micros) return totals.micros[microKey] ?? 0
  return 0
}

function classify(pct: number): AdequacyClass {
  if (pct < ADEQUATE_MIN) return 'abaixo'
  if (pct > ADEQUATE_MAX) return 'acima'
  return 'adequado'
}

export function computeAdequacy(totals: Nutrients, dris: Map<string, DriValue>): AdequacyResult {
  const items: AdequacyItem[] = []
  for (const [nutrientKey, dri] of dris) {
    const microKey = DRIKEY_TO_MICRO.get(nutrientKey)
    const label =
      nutrientKey === 'fibra' ? 'Fibra' : (micronutrientDef(microKey ?? '')?.label ?? nutrientKey)
    const total = Math.round(consumed(nutrientKey, totals) * 100) / 100
    const pct = dri.value > 0 ? Math.round((total / dri.value) * 1000) / 10 : null
    items.push({
      nutrientKey,
      label,
      unit: dri.unit,
      total,
      dri: dri.value,
      pct,
      class: pct === null ? 'sem_referencia' : classify(pct),
    })
  }
  items.sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999))
  return {
    items,
    deficits: items.filter((i) => i.class === 'abaixo').length,
    excesses: items.filter((i) => i.class === 'acima').length,
  }
}
