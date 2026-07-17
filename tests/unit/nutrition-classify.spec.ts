/**
 * T018 (Feature 046) — classificação de IMC e RCQ.
 */
import { describe, it, expect } from 'vitest'
import { classifyImc, classifyWaistHip } from '@/lib/core/nutrition/classify'

describe('Feature 046 — classificação IMC', () => {
  it('faixas OMS (adulto)', () => {
    expect(classifyImc(17.5)).toBe('Magreza grau I')
    expect(classifyImc(22)).toBe('Eutrofia')
    expect(classifyImc(27)).toBe('Sobrepeso')
    expect(classifyImc(32)).toBe('Obesidade grau I')
    expect(classifyImc(37)).toBe('Obesidade grau II')
    expect(classifyImc(41)).toBe('Obesidade grau III')
  })

  it('idoso (≥60) usa Lipschitz', () => {
    expect(classifyImc(21, 70)).toBe('Baixo peso')
    expect(classifyImc(25, 70)).toBe('Eutrofia')
    expect(classifyImc(29, 70)).toBe('Sobrepeso')
  })
})

describe('Feature 046 — classificação RCQ', () => {
  it('homem 20-29 (Bray & Gray)', () => {
    expect(classifyWaistHip(0.82, 'M', 25)).toBe('Risco baixo')
    expect(classifyWaistHip(0.86, 'M', 25)).toBe('Risco moderado')
    expect(classifyWaistHip(0.92, 'M', 25)).toBe('Risco alto')
    expect(classifyWaistHip(0.98, 'M', 25)).toBe('Risco muito alto')
  })

  it('mulher 20-29', () => {
    expect(classifyWaistHip(0.7, 'F', 25)).toBe('Risco baixo')
    expect(classifyWaistHip(0.8, 'F', 25)).toBe('Risco alto')
  })

  it('< 20 anos não classifica', () => {
    expect(classifyWaistHip(0.9, 'M', 18)).toBeNull()
  })
})
