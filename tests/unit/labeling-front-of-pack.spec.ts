import { describe, expect, it } from 'vitest'
import { composeLabel, type LabelIngredient } from '@/lib/core/nutrition/labeling/compose'
import type { FoodRef } from '@/lib/core/nutrition/diet/totals'

/**
 * Feature 052 (T025) — rotulagem nutricional frontal, a "lupa" (RDC 429/2020).
 *
 * O erro mais caro possível nesta feature é concluir "não precisa de lupa" a
 * partir de dado faltante: põe produto irregular na prateleira. Por isso existe
 * o veredito `inconclusivo`, e por isso ele é testado com o mesmo peso dos
 * outros dois.
 */

/**
 * Alimento por 100 g com os três nutrientes da lupa controláveis. Como o
 * rendimento e a quantidade são 1000 g nos testes, o valor por 100 g do produto
 * final é igual ao do alimento — o que deixa a fronteira legível.
 */
function food(over: {
  acucar?: number | undefined
  saturada?: number | undefined
  sodio?: number | undefined
  semMicros?: boolean
}): FoodRef {
  const micros: Record<string, number> = {
    acucar_total_g: 10,
    ag_trans_g: 0,
  }
  if (over.acucar !== undefined) micros.acucar_adicao_g = over.acucar
  if (over.saturada !== undefined) micros.ag_saturados_g = over.saturada
  if (over.sodio !== undefined) micros.sodio_mg = over.sodio
  return {
    referenceGrams: 100,
    energyKcal: 100,
    proteinG: 5,
    carbG: 20,
    fatG: 5,
    fiberG: 1,
    micros: over.semMicros ? null : micros,
  }
}

function build(f: FoodRef, basis: 'solido' | 'liquido' = 'solido') {
  const ing: LabelIngredient = { foodId: 'x', name: 'Ingrediente', grams: 1000, food: f }
  return composeLabel({ ingredients: [ing], totalYield: 1000, portionSize: 100, basis })
}

const cheio = { acucar: 0, saturada: 0, sodio: 0 }

describe('lupa — açúcares adicionados', () => {
  it('acima do limite de sólidos (15 g/100 g) aplica', () => {
    expect(build(food({ ...cheio, acucar: 20 })).frontOfPack.acucares_adicionados).toBe('aplica')
  })

  it('EXATAMENTE no limite aplica — a norma usa "maior ou igual"', () => {
    // Um `>` no lugar de `>=` deixaria passar produto irregular.
    expect(build(food({ ...cheio, acucar: 15 })).frontOfPack.acucares_adicionados).toBe('aplica')
  })

  it('abaixo do limite não aplica', () => {
    expect(build(food({ ...cheio, acucar: 14 })).frontOfPack.acucares_adicionados).toBe('nao_aplica')
  })
})

describe('lupa — gorduras saturadas', () => {
  it('respeita o limite de 6 g/100 g em sólidos', () => {
    expect(build(food({ ...cheio, saturada: 7 })).frontOfPack.gorduras_saturadas).toBe('aplica')
    expect(build(food({ ...cheio, saturada: 6 })).frontOfPack.gorduras_saturadas).toBe('aplica')
    expect(build(food({ ...cheio, saturada: 5 })).frontOfPack.gorduras_saturadas).toBe('nao_aplica')
  })
})

describe('lupa — sódio', () => {
  it('respeita o limite de 600 mg/100 g em sólidos', () => {
    expect(build(food({ ...cheio, sodio: 700 })).frontOfPack.sodio).toBe('aplica')
    expect(build(food({ ...cheio, sodio: 600 })).frontOfPack.sodio).toBe('aplica')
    expect(build(food({ ...cheio, sodio: 599 })).frontOfPack.sodio).toBe('nao_aplica')
  })
})

describe('lupa — sólido versus líquido', () => {
  it('o mesmo produto pode se enquadrar como líquido e não como sólido', () => {
    // 10 g de açúcar por 100: abaixo dos 15 g de sólido, acima dos 7,5 g de líquido.
    const f = food({ ...cheio, acucar: 10 })
    expect(build(f, 'solido').frontOfPack.acucares_adicionados).toBe('nao_aplica')
    expect(build(f, 'liquido').frontOfPack.acucares_adicionados).toBe('aplica')
  })

  it('vale para os três nutrientes', () => {
    const f = food({ acucar: 8, saturada: 4, sodio: 400 })
    const solido = build(f, 'solido').frontOfPack
    const liquido = build(f, 'liquido').frontOfPack
    expect(solido).toEqual({
      acucares_adicionados: 'nao_aplica',
      gorduras_saturadas: 'nao_aplica',
      sodio: 'nao_aplica',
    })
    expect(liquido).toEqual({
      acucares_adicionados: 'aplica',
      gorduras_saturadas: 'aplica',
      sodio: 'aplica',
    })
  })
})

describe('lupa — inconclusivo', () => {
  it('nutriente sem dado NÃO conclui pela ausência da marca', () => {
    // Sem açúcares adicionados na base, dizer "não aplica" seria afirmar que o
    // produto está liberado sem saber. O certo é não concluir.
    const semAcucar = food({ saturada: 1, sodio: 10 }) // acucar undefined
    expect(build(semAcucar).frontOfPack.acucares_adicionados).toBe('inconclusivo')
  })

  it('alimento sem nenhum micro deixa as três marcas inconclusivas', () => {
    const r = build(food({ semMicros: true }))
    expect(r.frontOfPack).toEqual({
      acucares_adicionados: 'inconclusivo',
      gorduras_saturadas: 'inconclusivo',
      sodio: 'inconclusivo',
    })
  })

  it('cada marca é avaliada isoladamente', () => {
    // Açúcar conhecido e alto; sódio desconhecido. Uma conclui, a outra não.
    const f = food({ acucar: 20, saturada: 1 }) // sodio undefined
    const r = build(f).frontOfPack
    expect(r.acucares_adicionados).toBe('aplica')
    expect(r.gorduras_saturadas).toBe('nao_aplica')
    expect(r.sodio).toBe('inconclusivo')
  })

  it('sobrescrever o valor faltante resolve o inconclusivo', () => {
    const ing: LabelIngredient = {
      foodId: 'x',
      name: 'Ingrediente',
      grams: 1000,
      food: food({ saturada: 1, sodio: 10 }),
    }
    const r = composeLabel({
      ingredients: [ing],
      totalYield: 1000,
      portionSize: 100,
      basis: 'solido',
      manualValues: { acucares_adicionados: 22 },
    })
    expect(r.frontOfPack.acucares_adicionados).toBe('aplica')
  })
})
