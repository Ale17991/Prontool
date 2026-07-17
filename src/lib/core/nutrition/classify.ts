/**
 * Feature 046 — classificações de IMC e RCQ. Puro e isomórfico.
 */

import type { Sex } from './age-sex'

/**
 * Classificação de IMC (OMS, adultos). Para ≥ 60 anos usa os pontos de corte
 * de Lipschitz (idoso). Retorna rótulo curto.
 */
export function classifyImc(imc: number, ageYears?: number): string {
  if (ageYears !== undefined && ageYears >= 60) {
    if (imc < 22) return 'Baixo peso'
    if (imc < 27) return 'Eutrofia'
    return 'Sobrepeso'
  }
  if (imc < 16) return 'Magreza grau III'
  if (imc < 17) return 'Magreza grau II'
  if (imc < 18.5) return 'Magreza grau I'
  if (imc < 25) return 'Eutrofia'
  if (imc < 30) return 'Sobrepeso'
  if (imc < 35) return 'Obesidade grau I'
  if (imc < 40) return 'Obesidade grau II'
  return 'Obesidade grau III'
}

// Tabela de risco de RCQ (Bray & Gray, 1988) por sexo e faixa etária.
// Cada entrada: [limiteBaixo, limiteModerado, limiteAlto] — acima do último = "Muito alto".
type RcqBand = { maxAge: number; cuts: [number, number, number] }

const RCQ_TABLE: Record<Sex, RcqBand[]> = {
  M: [
    { maxAge: 29, cuts: [0.83, 0.88, 0.94] },
    { maxAge: 39, cuts: [0.84, 0.91, 0.96] },
    { maxAge: 49, cuts: [0.88, 0.95, 1.0] },
    { maxAge: 59, cuts: [0.9, 0.96, 1.02] },
    { maxAge: 200, cuts: [0.91, 0.98, 1.03] },
  ],
  F: [
    { maxAge: 29, cuts: [0.71, 0.77, 0.82] },
    { maxAge: 39, cuts: [0.72, 0.78, 0.84] },
    { maxAge: 49, cuts: [0.73, 0.79, 0.87] },
    { maxAge: 59, cuts: [0.74, 0.81, 0.88] },
    { maxAge: 200, cuts: [0.76, 0.83, 0.9] },
  ],
}

/**
 * Classificação de risco pela Relação Cintura-Quadril (RCQ). Só se aplica a
 * partir de 20 anos; abaixo disso retorna null.
 */
export function classifyWaistHip(ratio: number, sex: Sex, ageYears: number): string | null {
  if (ageYears < 20) return null
  const band = RCQ_TABLE[sex].find((b) => ageYears <= b.maxAge) ?? RCQ_TABLE[sex][RCQ_TABLE[sex].length - 1]!
  const [low, mod, high] = band.cuts
  if (ratio <= low) return 'Risco baixo'
  if (ratio <= mod) return 'Risco moderado'
  if (ratio <= high) return 'Risco alto'
  return 'Risco muito alto'
}
