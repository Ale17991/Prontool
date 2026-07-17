/**
 * Feature 046 — helpers de idade/sexo para o motor de avaliação nutricional.
 * Puro (sem deps), isomórfico (cliente + servidor).
 */

export type Sex = 'M' | 'F'

/**
 * Idade em anos completos entre `birth` e `at` (ambos `YYYY-MM-DD`).
 * Usada para congelar a idade da avaliação e escolher faixas etárias das
 * equações/protocolos.
 */
export function ageFromBirthdate(birthYmd: string, atYmd: string): number {
  const [by, bm, bd] = birthYmd.split('-').map(Number)
  const [ay, am, ad] = atYmd.split('-').map(Number)
  if (!by || !bm || !bd || !ay || !am || !ad) {
    throw new Error(`ageFromBirthdate: datas inválidas (${birthYmd}, ${atYmd})`)
  }
  let age = ay - by
  if (am < bm || (am === bm && ad < bd)) age -= 1
  return age
}

/** log base 10 (Excel `LOG`/`LOG10`). */
export function log10(x: number): number {
  return Math.log(x) / Math.LN10
}

/** Arredonda para `d` casas (padrão do relatório). */
export function round(x: number, d = 2): number {
  const f = 10 ** d
  return Math.round(x * f) / f
}
