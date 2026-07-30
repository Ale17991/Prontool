import type { LabelNutrientDef } from './reference'

/**
 * Feature 052 — arredondamento e quantidades não significativas da rotulagem.
 * IN 75/2020, Anexos III e IV. Puro, sem I/O.
 *
 * REGRA DE OURO: isto é APRESENTAÇÃO. O motor soma e grava em precisão cheia;
 * arredondar antes de somar acumula erro, e arredondar antes de gravar torna o
 * dado bruto irrecuperável. Estas funções só entram na hora de exibir na tela
 * ou imprimir no PDF.
 *
 * ⚠️ Números pendentes de conferência contra o texto oficial (tarefa T033).
 */

/**
 * Anexo III — arredondamento por faixa de grandeza.
 *
 * A norma descreve o arredondamento em termos de "olhar a casa decimal
 * seguinte": para valores ≥ 10 olha-se a 1ª decimal e expressa-se inteiro;
 * de 1 a < 10 olha-se a 2ª decimal e expressa-se com até 1 decimal; abaixo de
 * 1 a precisão depende da unidade.
 *
 * Devolve NÚMERO, não string — a formatação (vírgula decimal) é da camada de
 * exibição.
 */
export function roundForLabel(value: number, unit: 'kcal' | 'g' | 'mg'): number {
  if (!Number.isFinite(value)) return 0
  const abs = Math.abs(value)

  if (abs >= 10) {
    // Olha a 1ª decimal, expressa em inteiro.
    return round(value, 0)
  }

  if (abs >= 1) {
    // Olha a 2ª decimal; se a 1ª virar 0, o valor sai inteiro naturalmente.
    return round(value, 1)
  }

  // Abaixo de 1: em gramas, 1 decimal; em mg (e demais unidades pequenas),
  // até 2 decimais.
  if (unit === 'g') return round(value, 1)
  return round(value, 2)
}

/**
 * Arredondamento meio-para-cima em valor absoluto (a norma diz "≥ 5 aumenta").
 * `Math.round` do JS enviesa negativos, e `toFixed` sofre com binário
 * (1.005.toFixed(2) === '1.00'), então a conta é feita em inteiros.
 */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const scaled = value * factor
  // Corrige o ruído binário antes de decidir a casa (ex.: 1.005*100 = 100.49999).
  const corrected = Number(scaled.toPrecision(12))
  const rounded = corrected >= 0 ? Math.round(corrected) : -Math.round(-corrected)
  return rounded / factor
}

/**
 * Anexo IV — quantidade não significativa.
 *
 * Valor calculado igual ou abaixo do limite é DECLARADO como zero. Este zero é
 * a declaração correta e é coisa completamente diferente de dado desconhecido:
 * "o produto praticamente não tem sódio" versus "não sei quanto tem".
 * Confundir os dois é falsear rótulo — ver `compose.ts`, que trata o
 * desconhecido como `null` e nunca chega aqui.
 */
export function isInsignificant(value: number, nutrient: LabelNutrientDef): boolean {
  if (!Number.isFinite(value)) return false
  return Math.abs(value) <= nutrient.insignificantAtOrBelow
}

/**
 * Valor pronto para a tabela: aplica o Anexo IV e, se passar, o Anexo III.
 * Recebe `null` quando o dado é desconhecido e devolve `null` — o desconhecido
 * atravessa sem virar zero.
 */
export function declaredValue(value: number | null, nutrient: LabelNutrientDef): number | null {
  if (value === null) return null
  if (isInsignificant(value, nutrient)) return 0
  return roundForLabel(value, nutrient.unit)
}

/** %VD arredondado para inteiro. `null` quando não há VDR ou o valor é desconhecido. */
export function declaredDvPercent(
  perPortion: number | null,
  nutrient: LabelNutrientDef,
): number | null {
  if (perPortion === null || nutrient.dv === null || nutrient.dv <= 0) return null
  return round((perPortion / nutrient.dv) * 100, 0)
}

/** Formata para exibição em pt-BR (vírgula decimal). `null` vira travessão. */
export function formatDeclared(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}
