/**
 * Distribuição e prescrição de macros — motor puro.
 *
 * Os números daqui viram a meta de cada refeição do plano do paciente, então o
 * que se testa aqui é sobretudo o que NÃO pode acontecer: a soma das refeições
 * divergir do total, e o carboidrato sumir quando a profissional prescreve
 * proteína e gordura por quilo.
 */
import { describe, expect, it } from 'vitest'
import {
  distributeMacros,
  mealDeltas,
  prescribeMacros,
  splitEvenly,
  suggestedShares,
  type MealShare,
} from '@/lib/core/nutrition/macro-distribution'

const MACROS = { protG: 120, carbG: 250, lipG: 60 }
const VET = 2020

const meals = (pcts: number[]): MealShare[] =>
  pcts.map((pct, i) => ({ key: `m${i}`, name: `Refeição ${i + 1}`, pct }))

describe('distribuição entre refeições', () => {
  it('reparte cada macro proporcionalmente ao percentual da refeição', () => {
    const r = distributeMacros({ targetKcal: VET, macros: MACROS, meals: meals([25, 75]) })
    expect(r.meals[0]!.kcal).toBeCloseTo(505, 6)
    expect(r.meals[0]!.protG).toBeCloseTo(30, 6)
    expect(r.meals[1]!.carbG).toBeCloseTo(187.5, 6)
  })

  it('a soma das refeições fecha exatamente com o total', () => {
    const r = distributeMacros({ targetKcal: VET, macros: MACROS, meals: meals(splitEvenly(6)) })
    const soma = (k: 'kcal' | 'protG' | 'carbG' | 'lipG') =>
      r.meals.reduce((s, m) => s + m[k], 0)
    expect(soma('kcal')).toBeCloseTo(VET, 6)
    expect(soma('protG')).toBeCloseTo(MACROS.protG, 6)
    expect(soma('carbG')).toBeCloseTo(MACROS.carbG, 6)
    expect(soma('lipG')).toBeCloseTo(MACROS.lipG, 6)
  })

  it('acusa desequilíbrio sem travar — digitar passa por soma errada', () => {
    const parcial = distributeMacros({ targetKcal: VET, macros: MACROS, meals: meals([30, 30]) })
    expect(parcial.balanced).toBe(false)
    expect(parcial.pctSum).toBe(60)
    expect(parcial.unallocatedKcal).toBeCloseTo(VET * 0.4, 6)
    // Continua devolvendo as refeições calculadas, não um erro.
    expect(parcial.meals).toHaveLength(2)
  })

  it('percentual acima de 100 dá sobra NEGATIVA, não zero', () => {
    const r = distributeMacros({ targetKcal: VET, macros: MACROS, meals: meals([70, 60]) })
    expect(r.balanced).toBe(false)
    expect(r.unallocatedKcal).toBeLessThan(0)
  })

  it('percentual não numérico conta como zero em vez de contaminar a soma', () => {
    const r = distributeMacros({
      targetKcal: VET,
      macros: MACROS,
      meals: [{ key: 'a', name: 'A', pct: Number.NaN }, { key: 'b', name: 'B', pct: 100 }],
    })
    expect(r.pctSum).toBe(100)
    expect(r.meals[0]!.kcal).toBe(0)
    expect(r.balanced).toBe(true)
  })
})

describe('divisão automática', () => {
  it('splitEvenly sempre soma exatamente 100', () => {
    for (let n = 1; n <= 12; n++) {
      const s = splitEvenly(n)
      expect(s).toHaveLength(n)
      expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6)
    }
  })

  it('o resto da divisão vai para a primeira refeição, não espalhado', () => {
    const s = splitEvenly(3)
    expect(s[1]).toBe(s[2])
    expect(s[0]).toBeGreaterThan(s[1]!)
  })

  it('splitEvenly com zero refeições não quebra', () => {
    expect(splitEvenly(0)).toEqual([])
  })

  it('as sugestões de partida somam 100 em toda contagem usual', () => {
    for (let n = 1; n <= 8; n++) {
      expect(suggestedShares(n).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6)
    }
  })
})

describe('prescrição por percentual', () => {
  it('converte o VET em gramas pelos fatores de Atwater', () => {
    const r = prescribeMacros({
      mode: 'percent',
      targetKcal: 2000,
      weightKg: 70,
      protPct: 30,
      carbPct: 45,
      lipPct: 25,
    })
    expect(r.protG).toBeCloseTo(150, 6)
    expect(r.carbG).toBeCloseTo(225, 6)
    expect(r.lipG).toBeCloseTo(55.5556, 3)
  })
})

describe('prescrição por g/kg', () => {
  it('carboidrato ausente FECHA o VET — é assim que a conta é feita', () => {
    const r = prescribeMacros({
      mode: 'gkg',
      targetKcal: 2000,
      weightKg: 70,
      protGkg: 1.8,
      lipGkg: 1,
    })
    expect(r.protG).toBeCloseTo(126, 6)
    expect(r.lipG).toBeCloseTo(70, 6)
    // 2000 − 126*4 − 70*9 = 866 kcal → 216,5 g de carboidrato.
    expect(r.carbG).toBeCloseTo(216.5, 6)
    expect(r.protKcal + r.carbKcal + r.lipKcal).toBeCloseTo(2000, 6)
    expect(r.residualKcal).toBe(0)
  })

  it('carboidrato ZERO explícito é respeitado — cetogênica é prescrição legítima', () => {
    const r = prescribeMacros({
      mode: 'gkg',
      targetKcal: 2000,
      weightKg: 70,
      protGkg: 2,
      lipGkg: 1.5,
      carbGkg: 0,
    })
    expect(r.carbG).toBe(0)
    // Zero explícito NÃO vira "fecha o VET": o que sobra aparece como resíduo.
    expect(r.residualKcal).not.toBe(0)
  })

  it('proteína e gordura acima do VET não geram carboidrato negativo', () => {
    const r = prescribeMacros({
      mode: 'gkg',
      targetKcal: 1200,
      weightKg: 100,
      protGkg: 2.5,
      lipGkg: 1.5,
    })
    expect(r.carbG).toBe(0)
    // O excesso fica VISÍVEL em vez de sumir num carboidrato negativo.
    expect(r.residualKcal).toBeLessThan(0)
  })

  it('devolve o percentual efetivo de cada macro para conferência', () => {
    const r = prescribeMacros({
      mode: 'gkg',
      targetKcal: 2000,
      weightKg: 70,
      protGkg: 1.8,
      lipGkg: 1,
    })
    expect(r.protPct + r.carbPct + r.lipPct).toBeCloseTo(100, 6)
    expect(r.protPct).toBeCloseTo(25.2, 3)
  })
})

describe('diferença entre o plano e a meta da refeição', () => {
  it('positivo é acima da meta, negativo é abaixo', () => {
    const alvos = distributeMacros({
      targetKcal: 2000,
      macros: { protG: 100, carbG: 200, lipG: 50 },
      meals: meals([50, 50]),
    }).meals
    const d = mealDeltas(alvos, [
      { key: 'm0', kcal: 1200, protG: 60, carbG: 110, lipG: 30 },
      { key: 'm1', kcal: 800, protG: 40, carbG: 90, lipG: 20 },
    ])
    expect(d[0]!.kcal).toBeCloseTo(200, 6)
    expect(d[1]!.kcal).toBeCloseTo(-200, 6)
  })

  it('refeição sem meta não entra na comparação', () => {
    const alvos = distributeMacros({
      targetKcal: 2000,
      macros: { protG: 100, carbG: 200, lipG: 50 },
      meals: meals([100]),
    }).meals
    // Um "excesso" aqui seria só a ausência de alvo, não erro do plano.
    expect(mealDeltas(alvos, [{ key: 'outra', kcal: 500, protG: 1, carbG: 1, lipG: 1 }])).toEqual([])
  })
})
