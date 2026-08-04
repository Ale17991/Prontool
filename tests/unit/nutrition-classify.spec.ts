/**
 * T018 (Feature 046) — classificação de IMC e RCQ.
 */
import { describe, it, expect } from 'vitest'
import { classifyBodyFat, classifyImc, classifyWaistHip } from '@/lib/core/nutrition/classify'

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

describe('classificação do %gordura (Pollock & Wilmore 1993)', () => {
  it('classifica homem de 30 anos pelas faixas da tabela', () => {
    // 26-35: excelente ≤12 · bom ≤16 · melhor ≤18 · média ≤22 · acima ≤24 · ruim ≤28
    expect(classifyBodyFat(10, 'M', 30)).toBe('Excelente')
    expect(classifyBodyFat(15, 'M', 30)).toBe('Bom')
    expect(classifyBodyFat(17, 'M', 30)).toBe('Melhor que a média')
    expect(classifyBodyFat(21, 'M', 30)).toBe('Média')
    expect(classifyBodyFat(23, 'M', 30)).toBe('Acima da média')
    expect(classifyBodyFat(27, 'M', 30)).toBe('Ruim')
    expect(classifyBodyFat(35, 'M', 30)).toBe('Muito ruim')
  })

  it('a mulher tem faixas próprias, mais altas que as do homem', () => {
    // 26-35 feminino: excelente ≤18 · média ≤27.
    expect(classifyBodyFat(17, 'F', 30)).toBe('Excelente')
    expect(classifyBodyFat(26, 'F', 30)).toBe('Média')
    // O mesmo 26% no homem já é "Muito ruim"… não: é "Ruim". O ponto é que
    // difere — usar a tabela masculina numa mulher a classificaria pior.
    expect(classifyBodyFat(26, 'M', 30)).not.toBe(classifyBodyFat(26, 'F', 30))
  })

  it('o limite exato da faixa pertence à faixa de baixo', () => {
    expect(classifyBodyFat(12, 'M', 30)).toBe('Excelente')
    expect(classifyBodyFat(12.1, 'M', 30)).toBe('Bom')
  })

  it('fora de 18 a 65 anos devolve null em vez de esticar a tabela', () => {
    // Extrapolar referência de composição corporal é inventar diagnóstico.
    expect(classifyBodyFat(20, 'M', 17)).toBeNull()
    expect(classifyBodyFat(20, 'M', 70)).toBeNull()
  })
})
