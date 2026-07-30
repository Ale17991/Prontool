import { describe, expect, it } from 'vitest'
import { composeLabel, type LabelIngredient } from '@/lib/core/nutrition/labeling/compose'
import type { FoodRef } from '@/lib/core/nutrition/diet/totals'

/**
 * Feature 052 (T010/T019) — motor de composição do rótulo.
 *
 * Duas garantias que este arquivo existe para travar:
 *  1. as contas batem (SC-002) — por porção e %VD conferem com o cálculo manual;
 *  2. dado desconhecido NUNCA vira zero (SC-004) — um ingrediente sem o dado
 *     torna o nutriente inteiro indefinido, porque somar só o que se conhece
 *     subdeclararia o rótulo.
 */

/** Alimento por 100 g, com todos os nutrientes de rótulo conhecidos. */
function food(over: Partial<FoodRef> = {}): FoodRef {
  return {
    referenceGrams: 100,
    energyKcal: 100,
    proteinG: 10,
    carbG: 20,
    fatG: 5,
    fiberG: 2,
    micros: {
      acucar_total_g: 8,
      acucar_adicao_g: 6,
      ag_saturados_g: 1,
      ag_trans_g: 0.2,
      sodio_mg: 50,
    },
    ...over,
  }
}

function ing(name: string, grams: number, f: FoodRef = food()): LabelIngredient {
  return { foodId: `id-${name}`, name, grams, food: f }
}

const base = { totalYield: 1000, portionSize: 100, basis: 'solido' as const }

function row(result: ReturnType<typeof composeLabel>, key: string) {
  return result.rows.find((r) => r.key === key)!
}

describe('composição — as contas batem (SC-002)', () => {
  it('escala do preparo para 100 g e para a porção', () => {
    // 1000 g de um alimento de 100 kcal/100 g = 1000 kcal no preparo.
    // Rendimento 1000 g → 100 kcal por 100 g. Porção 100 g → 100 kcal.
    const r = composeLabel({ ...base, ingredients: [ing('A', 1000)] })
    expect(row(r, 'energia').per100).toBe(100)
    expect(row(r, 'energia').perPortion).toBe(100)
  })

  it('a porção é proporcional ao seu tamanho', () => {
    // Mesma composição, porção de 60 g → 60% do valor por 100 g.
    const r = composeLabel({ ...base, portionSize: 60, ingredients: [ing('A', 1000)] })
    expect(row(r, 'energia').per100).toBe(100)
    expect(row(r, 'energia').perPortion).toBe(60)
  })

  it('a perda por cocção CONCENTRA os valores', () => {
    // 1000 g de ingredientes rendendo 900 g de bolo: os valores por 100 g ficam
    // MAIORES que a média crua. Deduzir o rendimento da soma dos ingredientes
    // erraria aqui, sempre subdeclarando.
    const r = composeLabel({ ...base, totalYield: 900, ingredients: [ing('A', 1000)] })
    expect(row(r, 'energia').per100).toBe(111) // 1000 kcal / 900 g * 100
  })

  it('soma vários ingredientes', () => {
    // 500 g de 100 kcal/100g + 500 g de 300 kcal/100g = 500 + 1500 = 2000 kcal
    const denso = food({ energyKcal: 300 })
    const r = composeLabel({
      ...base,
      ingredients: [ing('A', 500), ing('B', 500, denso)],
    })
    expect(row(r, 'energia').per100).toBe(200)
  })

  it('respeita a porção de referência do alimento', () => {
    // Alimento declarado por 50 g: 200 g no preparo = 4 porções de referência.
    const por50 = food({ referenceGrams: 50, energyKcal: 100 })
    const r = composeLabel({ ...base, totalYield: 200, ingredients: [ing('A', 200, por50)] })
    expect(row(r, 'energia').per100).toBe(200) // 400 kcal / 200 g * 100
  })

  it('calcula o %VD sobre os valores da norma', () => {
    const r = composeLabel({ ...base, ingredients: [ing('A', 1000)] })
    // 100 kcal por porção sobre 2000 kcal = 5%
    expect(row(r, 'energia').dvPercent).toBe(5)
    // 50 mg de sódio por porção sobre 2000 mg = 2,5% → 3%
    expect(row(r, 'sodio').dvPercent).toBe(3)
  })

  it('açúcares totais saem SEM %VD', () => {
    const r = composeLabel({ ...base, ingredients: [ing('A', 1000)] })
    const at = row(r, 'acucares_totais')
    expect(at.per100).toBe(8)
    expect(at.dvPercent).toBeNull() // a norma não estabelece VDR
  })

  it('declara os 10 nutrientes obrigatórios, na ordem da norma', () => {
    const r = composeLabel({ ...base, ingredients: [ing('A', 1000)] })
    expect(r.rows.map((x) => x.key)).toEqual([
      'energia',
      'carboidratos',
      'acucares_totais',
      'acucares_adicionados',
      'proteinas',
      'gorduras_totais',
      'gorduras_saturadas',
      'gorduras_trans',
      'fibra_alimentar',
      'sodio',
    ])
  })

  it('grava a versão da norma usada', () => {
    const r = composeLabel({ ...base, ingredients: [ing('A', 1000)] })
    expect(r.normativeVersion).toContain('IN 75/2020')
  })
})

describe('composição — dado desconhecido (SC-004)', () => {
  it('um ingrediente sem o dado torna o nutriente INDEFINIDO, não menor', () => {
    // O segundo alimento não tem açúcares adicionados. Somar só o primeiro
    // daria 6 g/100 g — um número plausível e ERRADO. O certo é não declarar.
    const semAcucar = food({ micros: { ag_saturados_g: 1, sodio_mg: 10 } })
    const r = composeLabel({
      ...base,
      ingredients: [ing('Açúcar', 500), ing('Farinha', 500, semAcucar)],
    })
    const aa = row(r, 'acucares_adicionados')
    expect(aa.state).toBe('incompleto')
    expect(aa.per100).toBeNull()
    expect(aa.perPortion).toBeNull()
    expect(aa.dvPercent).toBeNull()
    expect(aa.missingFrom).toEqual(['Farinha'])
  })

  it('lista TODOS os ingredientes que faltaram', () => {
    const sem = food({ micros: { sodio_mg: 10 } })
    const r = composeLabel({
      ...base,
      ingredients: [ing('A', 300), ing('B', 300, sem), ing('C', 400, sem)],
    })
    expect(row(r, 'gorduras_trans').missingFrom).toEqual(['B', 'C'])
  })

  it('alimento sem NENHUM micro deixa os quatro nutrientes de micro indefinidos', () => {
    const r = composeLabel({ ...base, ingredients: [ing('A', 1000, food({ micros: null }))] })
    for (const k of ['acucares_totais', 'acucares_adicionados', 'gorduras_saturadas', 'gorduras_trans', 'sodio']) {
      expect(row(r, k).state, k).toBe('incompleto')
      expect(row(r, k).per100, k).toBeNull()
    }
    // Energia e macros vêm de coluna direta e seguem calculáveis.
    expect(row(r, 'energia').state).toBe('calculado')
  })

  it('fibra nula no alimento conta como desconhecida', () => {
    const r = composeLabel({ ...base, ingredients: [ing('A', 1000, food({ fiberG: null }))] })
    expect(row(r, 'fibra_alimentar').state).toBe('incompleto')
    expect(row(r, 'fibra_alimentar').per100).toBeNull()
  })

  it('marca o rótulo inteiro como incompleto', () => {
    const sem = food({ micros: null })
    const completo = composeLabel({ ...base, ingredients: [ing('A', 1000)] })
    const incompleto = composeLabel({ ...base, ingredients: [ing('A', 1000, sem)] })
    expect(completo.incomplete).toBe(false)
    expect(incompleto.incomplete).toBe(true)
  })

  it('valor conhecido e pequeno vira ZERO DECLARADO, não incompleto', () => {
    // Distinção central: "quase não tem sódio" ≠ "não sei quanto tem".
    const quaseNada = food({ micros: { ...food().micros, sodio_mg: 1 } })
    const r = composeLabel({
      ...base,
      totalYield: 1000,
      portionSize: 100,
      ingredients: [ing('A', 1000, quaseNada)],
    })
    const s = row(r, 'sodio')
    expect(s.state).toBe('calculado')
    expect(s.perPortion).toBe(0) // 1 mg por porção ≤ 5 mg → declara 0
    expect(s.per100).toBe(0)
  })

  it('rendimento inválido deixa tudo indefinido em vez de dividir por zero', () => {
    const r = composeLabel({ ...base, totalYield: 0, ingredients: [ing('A', 1000)] })
    expect(r.rows.every((x) => x.per100 === null)).toBe(true)
    expect(r.incomplete).toBe(true)
  })

  it('preparo sem ingredientes não inventa zeros', () => {
    const r = composeLabel({ ...base, ingredients: [] })
    // Sem ingredientes o total é 0 e é conhecido — declara 0, o que é honesto.
    expect(row(r, 'energia').state).toBe('calculado')
    expect(row(r, 'energia').per100).toBe(0)
  })
})

describe('composição — sobrescrita manual (US2)', () => {
  it('o valor informado prevalece e é declarado por 100 g', () => {
    const sem = food({ micros: null })
    const r = composeLabel({
      ...base,
      ingredients: [ing('A', 1000, sem)],
      manualValues: { acucares_adicionados: 18 },
    })
    const aa = row(r, 'acucares_adicionados')
    expect(aa.state).toBe('sobrescrito')
    expect(aa.per100).toBe(18)
    expect(aa.perPortion).toBe(18) // porção de 100 g
    expect(aa.missingFrom).toEqual([])
  })

  it('a sobrescrita escala para a porção', () => {
    const r = composeLabel({
      ...base,
      portionSize: 50,
      ingredients: [ing('A', 1000)],
      manualValues: { acucares_adicionados: 18 },
    })
    expect(row(r, 'acucares_adicionados').perPortion).toBe(9)
  })

  it('sobrescrita gera %VD normalmente', () => {
    const r = composeLabel({
      ...base,
      ingredients: [ing('A', 1000)],
      manualValues: { acucares_adicionados: 25 },
    })
    // 25 g sobre VDR de 50 g = 50%
    expect(row(r, 'acucares_adicionados').dvPercent).toBe(50)
  })

  it('sobrescrever resolve o incompleto do rótulo', () => {
    const sem = food({ micros: { acucar_total_g: 1, ag_saturados_g: 1, ag_trans_g: 0, sodio_mg: 1 } })
    const semOverride = composeLabel({ ...base, ingredients: [ing('A', 1000, sem)] })
    expect(semOverride.incomplete).toBe(true)

    const comOverride = composeLabel({
      ...base,
      ingredients: [ing('A', 1000, sem)],
      manualValues: { acucares_adicionados: 10 },
    })
    expect(comOverride.incomplete).toBe(false)
  })

  it('remover a sobrescrita volta ao calculado', () => {
    const args = { ...base, ingredients: [ing('A', 1000)] }
    const comOverride = composeLabel({ ...args, manualValues: { energia: 999 } })
    expect(row(comOverride, 'energia').per100).toBe(999)

    for (const removida of [{ energia: null }, { energia: undefined }, {}]) {
      const r = composeLabel({ ...args, manualValues: removida })
      expect(row(r, 'energia').state).toBe('calculado')
      expect(row(r, 'energia').per100).toBe(100)
    }
  })

  it('sobrescrita não contamina os outros nutrientes', () => {
    const r = composeLabel({
      ...base,
      ingredients: [ing('A', 1000)],
      manualValues: { energia: 999 },
    })
    expect(row(r, 'energia').state).toBe('sobrescrito')
    expect(row(r, 'proteinas').state).toBe('calculado')
    expect(row(r, 'proteinas').per100).toBe(10)
  })
})
