import { describe, expect, it } from 'vitest'
import { yDomainWithRange } from '@/components/patient-portal/evolution-chart'

/**
 * T021 (Feature 050 US2) — domínio do eixo Y com faixa de referência.
 *
 * O risco real: quando todos os resultados estão de um lado só da faixa (o caso
 * clinicamente alterado, o que mais importa ver), um domínio calculado só pelos
 * pontos deixaria a banda fora da área visível.
 */

describe('yDomainWithRange', () => {
  it("sem faixa, mantém o comportamento atual ('auto')", () => {
    expect(yDomainWithRange([10, 20, 30])).toEqual(['auto', 'auto'])
    expect(yDomainWithRange([10, 20], null, null)).toEqual(['auto', 'auto'])
  })

  it('engloba a faixa quando os pontos estão todos ABAIXO dela', () => {
    // Ferritina 10–18 contra faixa 70–200: a banda precisa caber.
    const [lo, hi] = yDomainWithRange([10, 15, 18], 70, 200) as [number, number]
    expect(lo).toBeLessThanOrEqual(10)
    expect(hi).toBeGreaterThanOrEqual(200)
  })

  it('engloba a faixa quando os pontos estão todos ACIMA dela', () => {
    const [lo, hi] = yDomainWithRange([400, 520], 70, 150) as [number, number]
    expect(lo).toBeLessThanOrEqual(70)
    expect(hi).toBeGreaterThanOrEqual(520)
  })

  it('funciona com faixa só de teto (refMin null)', () => {
    const d = yDomainWithRange([40, 60], null, 100)
    expect(d[0]).not.toBe('auto')
    const [lo, hi] = d as [number, number]
    expect(lo).toBeLessThanOrEqual(40)
    expect(hi).toBeGreaterThanOrEqual(100)
  })

  it('funciona com faixa só de piso (refMax null)', () => {
    const d = yDomainWithRange([20, 30], 130, null)
    expect(d[0]).not.toBe('auto')
    const [lo, hi] = d as [number, number]
    expect(lo).toBeLessThanOrEqual(20)
    expect(hi).toBeGreaterThanOrEqual(130)
  })

  it('não desce abaixo de zero com dados não-negativos', () => {
    // Exame não tem valor negativo; um eixo indo a -5 mg/dL confunde.
    const [lo] = yDomainWithRange([1, 2], 0.5, 3) as [number, number]
    expect(lo).toBeGreaterThanOrEqual(0)
  })

  it('não colapsa quando todos os valores e a faixa são iguais', () => {
    const [lo, hi] = yDomainWithRange([100], 100, 100) as [number, number]
    expect(hi).toBeGreaterThan(lo)
  })

  it('ignora valores não-finitos sem quebrar', () => {
    const [lo, hi] = yDomainWithRange([Number.NaN, 50], 10, 90) as [number, number]
    expect(Number.isFinite(lo)).toBe(true)
    expect(Number.isFinite(hi)).toBe(true)
    expect(hi).toBeGreaterThanOrEqual(90)
  })

  it('série vazia com faixa ainda produz um domínio válido', () => {
    const [lo, hi] = yDomainWithRange([], 70, 200) as [number, number]
    expect(Number.isFinite(lo)).toBe(true)
    expect(hi).toBeGreaterThan(lo)
  })
})
