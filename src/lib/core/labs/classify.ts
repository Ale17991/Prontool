import { labAnalyte } from './catalog'

/**
 * Feature 050 US1 — motor de classificação de exame laboratorial.
 *
 * Compara o resultado com a faixa de referência aplicável ao paciente e devolve
 * baixo / normal / alto / sem_referencia. Puro e isomórfico: a mesma função roda
 * na tela e no servidor.
 *
 * A classificação é uma leitura DERIVADA — nunca é persistida. Corrigir uma
 * faixa de referência reclassifica todo o histórico sem reescrever nenhum
 * resultado, o que preserva o append-only de `patient_measurements` (0113).
 *
 * Análogo de `nutrition/adequacy.ts` (049), com uma diferença: lá a DRI é um
 * alvo único e a leitura é um percentual; aqui há dois limites absolutos e
 * independentemente nuláveis — a fonte tem exames só com teto (triglicérides
 * ≤ 100) e só com piso (HDL ≥ 50).
 */

export type LabClass = 'baixo' | 'normal' | 'alto' | 'sem_referencia'

export interface LabRange {
  /** Piso da faixa. `null` = sem piso (exame do tipo "abaixo de X"). */
  refMin: number | null
  /** Teto da faixa. `null` = sem teto (exame do tipo "acima de X"). */
  refMax: number | null
  unit: string
  sourceLabel: string | null
}

/** Um resultado bruto, como sai de `patient_measurements`. */
export interface LabResultInput {
  analyteKey: string
  value: number
  unit: string
  /** Data do exame (ISO `YYYY-MM-DD`). */
  measuredAt: string
}

export interface LabResultItem {
  analyteKey: string
  label: string
  group: string
  unit: string
  value: number
  measuredAt: string
  refMin: number | null
  refMax: number | null
  sourceLabel: string | null
  class: LabClass
}

export interface LabPanelResult {
  items: LabResultItem[]
  /** Quantos resultados abaixo da faixa. */
  low: number
  /** Quantos acima. */
  high: number
}

/**
 * Classifica um valor contra uma faixa. Limites são **inclusivos** — valor igual
 * ao piso ou ao teto é normal, que é como o laboratório publica a faixa.
 */
export function classifyValue(value: number, range: LabRange | undefined | null): LabClass {
  if (!range) return 'sem_referencia'
  if (!Number.isFinite(value)) return 'sem_referencia'
  const { refMin, refMax } = range
  if (refMin === null && refMax === null) return 'sem_referencia'
  if (refMin !== null && value < refMin) return 'baixo'
  if (refMax !== null && value > refMax) return 'alto'
  return 'normal'
}

/** Alterados primeiro, depois normais, e sem referência por último. */
const CLASS_RANK: Record<LabClass, number> = {
  baixo: 0,
  alto: 0,
  normal: 1,
  sem_referencia: 2,
}

/**
 * Monta o painel do paciente: **o resultado mais recente de cada analito**,
 * classificado. A série histórica completa (para o gráfico de evolução) é
 * carregada à parte — aqui interessa o retrato atual.
 */
export function classifyLabResults(
  results: readonly LabResultInput[],
  ranges: ReadonlyMap<string, LabRange>,
): LabPanelResult {
  // Último por analito (empate de data resolve pela ordem de chegada).
  const latest = new Map<string, LabResultInput>()
  for (const r of results) {
    const cur = latest.get(r.analyteKey)
    if (!cur || r.measuredAt >= cur.measuredAt) latest.set(r.analyteKey, r)
  }

  const items: LabResultItem[] = []
  for (const r of latest.values()) {
    const def = labAnalyte(r.analyteKey)
    const range = ranges.get(r.analyteKey)
    items.push({
      analyteKey: r.analyteKey,
      label: def?.label ?? r.analyteKey,
      group: def?.group ?? 'Outros',
      unit: def?.unit ?? r.unit,
      value: r.value,
      measuredAt: r.measuredAt,
      refMin: range?.refMin ?? null,
      refMax: range?.refMax ?? null,
      sourceLabel: range?.sourceLabel ?? null,
      class: classifyValue(r.value, range),
    })
  }

  items.sort(
    (a, b) =>
      CLASS_RANK[a.class] - CLASS_RANK[b.class] ||
      (labAnalyte(a.analyteKey)?.displayOrder ?? 9999) -
        (labAnalyte(b.analyteKey)?.displayOrder ?? 9999) ||
      a.label.localeCompare(b.label, 'pt-BR'),
  )

  return {
    items,
    low: items.filter((i) => i.class === 'baixo').length,
    high: items.filter((i) => i.class === 'alto').length,
  }
}
