/**
 * Curvas de crescimento — motor de classificação.
 *
 * Errar aqui rotula uma criança saudável como desnutrida, ou o contrário. Os
 * testes cravam sobretudo os limites: fronteira de faixa, saturação nas pontas
 * e a recusa de extrapolar fora da tabela.
 */
import { describe, expect, it } from 'vitest'
import {
  ageInMonths,
  classifyByPercentile,
  classifyGrowth,
  estimatePercentile,
  interpolateRow,
  type PercentileRow,
} from '@/lib/core/growth/classify'

const row = (ageMonths: number, base: number): PercentileRow => ({
  ageMonths,
  p01: base,
  p3: base + 1,
  p5: base + 2,
  p10: base + 3,
  p15: base + 4,
  p50: base + 5,
  p85: base + 6,
  p97: base + 7,
  p999: base + 8,
})

const ROWS = [row(12, 10), row(13, 20)]

describe('interpolação por idade', () => {
  it('devolve a linha exata quando a idade bate', () => {
    expect(interpolateRow(ROWS, 12)!.p50).toBe(15)
  })

  it('interpola meio mês em vez de criar degrau', () => {
    // Sem interpolação, 12,5 meses cairia inteiro no mês 12 e a curva teria
    // degraus na fronteira de faixa.
    const r = interpolateRow(ROWS, 12.5)!
    expect(r.p50).toBe(20)
    expect(r.p01).toBe(15)
  })

  it('NÃO extrapola fora da tabela — devolve null', () => {
    expect(interpolateRow(ROWS, 11)).toBeNull()
    expect(interpolateRow(ROWS, 14)).toBeNull()
  })

  it('tabela vazia não quebra', () => {
    expect(interpolateRow([], 12)).toBeNull()
  })
})

describe('percentil estimado', () => {
  const r = row(24, 10)

  it('valor na coluna devolve o percentil daquela coluna', () => {
    expect(estimatePercentile(r, r.p50)).toBeCloseTo(50, 6)
    expect(estimatePercentile(r, r.p3)).toBeCloseTo(3, 6)
  })

  it('interpola entre colunas', () => {
    const meio = (r.p50 + r.p85) / 2
    expect(estimatePercentile(r, meio)).toBeCloseTo(67.5, 6)
  })

  it('satura nas pontas em vez de inventar precisão', () => {
    // A tabela começa em 0,1 — dizer "percentil 0,02" seria precisão que a
    // fonte não tem.
    expect(estimatePercentile(r, r.p01 - 100)).toBe(0.1)
    expect(estimatePercentile(r, r.p999 + 100)).toBe(99.9)
  })
})

describe('classificação por indicador', () => {
  it('IMC/idade cobre da magreza acentuada à obesidade', () => {
    expect(classifyByPercentile('imc_idade', 0.05).classification).toBe('muito_baixo')
    expect(classifyByPercentile('imc_idade', 2).classification).toBe('baixo')
    expect(classifyByPercentile('imc_idade', 50).classification).toBe('adequado')
    expect(classifyByPercentile('imc_idade', 90).classification).toBe('risco')
    expect(classifyByPercentile('imc_idade', 98).classification).toBe('elevado')
    expect(classifyByPercentile('imc_idade', 99.95).classification).toBe('muito_elevado')
  })

  it('o percentil 3 exato ainda é baixo, não adequado', () => {
    expect(classifyByPercentile('imc_idade', 3).classification).toBe('baixo')
    expect(classifyByPercentile('peso_idade', 3).classification).toBe('baixo')
  })

  it('estatura/idade NÃO tem faixa superior de risco', () => {
    // Criança alta não é diagnóstico.
    expect(classifyByPercentile('estatura_idade', 99.99).classification).toBe('adequado')
  })

  it('peso/idade não classifica excesso além de "elevado"', () => {
    // Quem responde por excesso de peso é o IMC/idade, que leva a estatura em
    // conta — peso/idade sozinho rotularia a criança simplesmente alta.
    expect(classifyByPercentile('peso_idade', 99.99).classification).toBe('elevado')
    expect(classifyByPercentile('peso_idade', 50).classification).toBe('adequado')
  })
})

describe('classifyGrowth ponta a ponta', () => {
  it('junta interpolação, percentil e rótulo', () => {
    const r = classifyGrowth({
      indicator: 'imc_idade',
      rows: ROWS,
      ageMonths: 12,
      value: 15, // p50 do mês 12
    })
    expect(r).not.toBeNull()
    expect(r!.percentile).toBeCloseTo(50, 6)
    expect(r!.classification).toBe('adequado')
    expect(r!.label).toBe('Eutrofia')
  })

  it('idade fora da tabela devolve null em vez de chutar', () => {
    expect(classifyGrowth({ indicator: 'imc_idade', rows: ROWS, ageMonths: 200, value: 15 })).toBeNull()
  })
})

describe('idade em meses', () => {
  it('conta meses cheios', () => {
    expect(ageInMonths('2020-01-15', '2021-01-15')).toBeCloseTo(12, 6)
    expect(ageInMonths('2020-01-15', '2020-07-15')).toBeCloseTo(6, 6)
  })

  it('leva a fração do mês em conta — bebê muda rápido demais para arredondar', () => {
    const m = ageInMonths('2020-01-01', '2020-02-16')
    expect(m).toBeGreaterThan(1.4)
    expect(m).toBeLessThan(1.6)
  })

  it('nunca devolve idade negativa', () => {
    expect(ageInMonths('2026-01-01', '2025-01-01')).toBe(0)
  })
})
