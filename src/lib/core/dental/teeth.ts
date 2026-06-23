/**
 * Feature 039 — Modelo de posição do odontograma (notação FDI / ISO 3950).
 *
 * Dentes permanentes: quadrantes 1–4 (11–18, 21–28, 31–38, 41–48).
 * Dentes decíduos:    quadrantes 5–8 (51–55, 61–65, 71–75, 81–85).
 *
 * Faces (enum do banco em inglês; rótulo PT-BR na UI):
 *   mesial · distal · occlusal_incisal · vestibular · lingual_palatal
 * `occlusal_incisal` unifica a face oclusal (posteriores) e incisal
 * (anteriores) — o rótulo correto é escolhido por `surfaceLabel`.
 */

export const SURFACES = [
  'mesial',
  'distal',
  'occlusal_incisal',
  'vestibular',
  'lingual_palatal',
  // Migration 0159 — regiões fora da coroa:
  'cervical', // colo do dente (restaurações cervicais)
  'raiz', // raiz/canal (endodontia)
] as const

export type Surface = (typeof SURFACES)[number]

export type Dentition = 'permanent' | 'deciduous'

/** Quadrantes na ordem anatômica de exibição (superior D→E, inferior E→D). */
const PERMANENT_QUADRANTS: ReadonlyArray<{ quadrant: number; teeth: number[] }> = [
  { quadrant: 1, teeth: [18, 17, 16, 15, 14, 13, 12, 11] },
  { quadrant: 2, teeth: [21, 22, 23, 24, 25, 26, 27, 28] },
  { quadrant: 4, teeth: [48, 47, 46, 45, 44, 43, 42, 41] },
  { quadrant: 3, teeth: [31, 32, 33, 34, 35, 36, 37, 38] },
]

const DECIDUOUS_QUADRANTS: ReadonlyArray<{ quadrant: number; teeth: number[] }> = [
  { quadrant: 5, teeth: [55, 54, 53, 52, 51] },
  { quadrant: 6, teeth: [61, 62, 63, 64, 65] },
  { quadrant: 8, teeth: [85, 84, 83, 82, 81] },
  { quadrant: 7, teeth: [71, 72, 73, 74, 75] },
]

export const PERMANENT_TEETH: number[] = PERMANENT_QUADRANTS.flatMap((q) => q.teeth)
export const DECIDUOUS_TEETH: number[] = DECIDUOUS_QUADRANTS.flatMap((q) => q.teeth)

const PERMANENT_SET = new Set(PERMANENT_TEETH)
const DECIDUOUS_SET = new Set(DECIDUOUS_TEETH)

/** Layout por quadrante para render da carta dentária. */
export function quadrantLayout(dentition: Dentition) {
  return dentition === 'permanent' ? PERMANENT_QUADRANTS : DECIDUOUS_QUADRANTS
}

export function isValidTooth(toothFdi: number): boolean {
  return PERMANENT_SET.has(toothFdi) || DECIDUOUS_SET.has(toothFdi)
}

export function isValidSurface(surface: string): surface is Surface {
  return (SURFACES as readonly string[]).includes(surface)
}

export function assertValidTooth(toothFdi: number): void {
  if (!isValidTooth(toothFdi)) {
    throw new Error(`INVALID_TOOTH_FDI: ${toothFdi} não é um dente FDI válido`)
  }
}

export function assertValidSurface(surface: string): void {
  if (!isValidSurface(surface)) {
    throw new Error(`INVALID_SURFACE: ${surface} não é uma face válida`)
  }
}

export function dentitionOf(toothFdi: number): Dentition {
  const quadrant = Math.floor(toothFdi / 10)
  return quadrant >= 5 ? 'deciduous' : 'permanent'
}

/** Anteriores: incisivos e caninos (posições 1–3 do quadrante). */
export function isAnterior(toothFdi: number): boolean {
  const position = toothFdi % 10
  return position >= 1 && position <= 3
}

/** Rótulo PT-BR da face, sensível ao tipo de dente (oclusal vs incisal). */
export function surfaceLabel(surface: Surface, toothFdi: number): string {
  switch (surface) {
    case 'mesial':
      return 'Mesial'
    case 'distal':
      return 'Distal'
    case 'vestibular':
      return 'Vestibular'
    case 'lingual_palatal':
      return 'Lingual/Palatina'
    case 'occlusal_incisal':
      return isAnterior(toothFdi) ? 'Incisal' : 'Oclusal'
    case 'cervical':
      return 'Cervical'
    case 'raiz':
      return 'Raiz / Canal'
  }
}

/** Dente superior? (quadrantes 1, 2, 5, 6). Define a orientação da raiz. */
export function isUpperTooth(toothFdi: number): boolean {
  const quadrant = Math.floor(toothFdi / 10)
  return quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6
}
