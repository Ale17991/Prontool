/**
 * Feature 041 — Periograma: sítios periodontais, faixas plausíveis e cálculos
 * puros (CAL e indicadores agregados). Sem dependência de banco — testável
 * isoladamente e reaproveitável por UI (cálculo ao vivo) e serviço.
 *
 * 6 sítios por dente (padrão AAP), distintos das faces do odontograma:
 *   vestibular:        db (disto), b (centro), mb (mésio)
 *   lingual/palatina:  dl (disto), l (centro), ml (mésio)
 */

export const PERIO_SITES = ['db', 'b', 'mb', 'dl', 'l', 'ml'] as const
export type PerioSite = (typeof PERIO_SITES)[number]

/** Sítios por arcada, na ordem disto→mésio de exibição na grade. */
export const BUCCAL_SITES: readonly PerioSite[] = ['db', 'b', 'mb']
export const LINGUAL_SITES: readonly PerioSite[] = ['dl', 'l', 'ml']

/** Faixas clínicas plausíveis (Clarification 2026-06-23 — rejeitar fora). */
export const PROBING_DEPTH_MIN = 0
export const PROBING_DEPTH_MAX = 15
export const RECESSION_MIN = -5
export const RECESSION_MAX = 15

/** Profundidade a partir da qual o sítio conta como "bolsa". */
export const POCKET_THRESHOLD_MM = 4

export function isValidPerioSite(site: string): site is PerioSite {
  return (PERIO_SITES as readonly string[]).includes(site)
}

export function isValidProbingDepth(mm: number): boolean {
  return Number.isInteger(mm) && mm >= PROBING_DEPTH_MIN && mm <= PROBING_DEPTH_MAX
}

export function isValidRecession(mm: number): boolean {
  return Number.isInteger(mm) && mm >= RECESSION_MIN && mm <= RECESSION_MAX
}

export function siteLabel(site: PerioSite): string {
  switch (site) {
    case 'db':
      return 'Disto-vestibular'
    case 'b':
      return 'Vestibular'
    case 'mb':
      return 'Mésio-vestibular'
    case 'dl':
      return 'Disto-lingual'
    case 'l':
      return 'Lingual/Palatina'
    case 'ml':
      return 'Mésio-lingual'
  }
}

/**
 * Nível de inserção clínica (CAL) = profundidade de sondagem + recessão (com
 * sinal: + recessão soma, − margem coronal reduz). Null se faltar PD.
 */
export function calcCal(probingDepthMm: number | null, recessionMm: number | null): number | null {
  if (probingDepthMm === null) return null
  return probingDepthMm + (recessionMm ?? 0)
}

export interface PerioMeasurementInput {
  toothFdi: number
  site: PerioSite
  probingDepthMm: number | null
  recessionMm: number | null
  bleeding: boolean
}

export interface PerioFindingInput {
  toothFdi: number
  isMissing: boolean
}

export interface PerioIndicators {
  sitesMeasured: number
  sitesBleeding: number
  bopPct: number
  pocketsGe4: number
  pocketsGe4Pct: number
  calAvgMm: number | null
}

/**
 * Indicadores agregados a partir das medições, ignorando dentes ausentes e
 * sítios sem profundidade registrada. Espelha a RPC `perio_exam_indicators`.
 */
export function calcIndicators(
  measurements: PerioMeasurementInput[],
  findings: PerioFindingInput[],
): PerioIndicators {
  const missing = new Set(findings.filter((f) => f.isMissing).map((f) => f.toothFdi))
  const valid = measurements.filter((m) => !missing.has(m.toothFdi) && m.probingDepthMm !== null)

  const sitesMeasured = valid.length
  const sitesBleeding = valid.filter((m) => m.bleeding).length
  const pocketsGe4 = valid.filter((m) => (m.probingDepthMm ?? 0) >= POCKET_THRESHOLD_MM).length
  const calSum = valid.reduce((acc, m) => acc + (m.probingDepthMm! + (m.recessionMm ?? 0)), 0)

  const round1 = (n: number) => Math.round(n * 10) / 10

  return {
    sitesMeasured,
    sitesBleeding,
    bopPct: sitesMeasured ? round1((100 * sitesBleeding) / sitesMeasured) : 0,
    pocketsGe4,
    pocketsGe4Pct: sitesMeasured ? round1((100 * pocketsGe4) / sitesMeasured) : 0,
    calAvgMm: sitesMeasured ? round1(calSum / sitesMeasured) : null,
  }
}
