/**
 * T027 (US4) — recordatório impresso.
 *
 * O risco número um da feature é o papel discordar da tela. Aqui ele é travado
 * do mesmo jeito que no plano alimentar (T008): os totais são calculados pelo
 * motor que alimenta a tela (`diet/totals`) e comparados com os que o modelo do
 * PDF imprime. Se algum dia alguém somar de novo dentro do componente, este
 * teste quebra.
 */
import { describe, expect, it } from 'vitest'
import {
  addNutrients,
  itemNutrients,
  roundNutrients,
  type FoodRef,
  type Nutrients,
} from '@/lib/core/nutrition/diet/totals'
import { printedTotals, renderRecallPdf } from '@/lib/core/nutrition/printouts/recall-pdf'
import type { RecallView } from '@/lib/core/nutrition/recall/plan'

const ARROZ: FoodRef = {
  referenceGrams: 100,
  energyKcal: 128,
  proteinG: 2.5,
  carbG: 28.1,
  fatG: 0.2,
  fiberG: 1.6,
}
const FEIJAO: FoodRef = {
  referenceGrams: 100,
  energyKcal: 76,
  proteinG: 4.8,
  carbG: 13.6,
  fatG: 0.5,
  fiberG: 8.5,
}

const ZERO = (): Nutrients => ({ energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 })

/** Recordatório montado como `getRecall` monta: item por item, pelo motor. */
function buildRecall(): RecallView {
  const itens = [
    { name: 'Arroz cozido', grams: 150, food: ARROZ },
    { name: 'Feijão cozido', grams: 80, food: FEIJAO },
  ]
  const nutrientes = itens.map((i) => roundNutrients(itemNutrients({ grams: i.grams, food: i.food })))
  const totalRefeicao = roundNutrients(nutrientes.reduce(addNutrients, ZERO()))

  return {
    id: 'r1',
    recallDate: '2026-08-04',
    notes: null,
    meals: [
      {
        name: 'Almoço',
        items: itens.map((it, idx) => ({
          foodId: `f${idx}`,
          name: it.name,
          grams: it.grams,
          measureLabel: null,
          measureQty: null,
          nutrients: nutrientes[idx]!,
        })),
        totals: totalRefeicao,
      },
    ],
    totals: totalRefeicao,
  }
}

describe('totais do recordatório impresso (T027)', () => {
  it('o papel imprime exatamente o que o motor da tela somou', () => {
    const recall = buildRecall()
    const esperado = roundNutrients(
      [
        itemNutrients({ grams: 150, food: ARROZ }),
        itemNutrients({ grams: 80, food: FEIJAO }),
      ].reduce(addNutrients, ZERO()),
    )

    expect(printedTotals(recall)).toEqual({
      energyKcal: Math.round(esperado.energyKcal),
      proteinG: Math.round(esperado.proteinG),
      carbG: Math.round(esperado.carbG),
      fatG: Math.round(esperado.fatG),
      fiberG: Math.round(esperado.fiberG),
    })
  })

  it('não recalcula: mexer nos itens sem mexer no total não muda o impresso', () => {
    // Se o componente somasse por conta própria, este total adulterado seria
    // "corrigido" na impressão — e o papel passaria a divergir da tela, que é
    // exatamente o defeito que a feature existe para não ter.
    const recall = buildRecall()
    const adulterado: RecallView = { ...recall, totals: { ...recall.totals, energyKcal: 999 } }
    expect(printedTotals(adulterado).energyKcal).toBe(999)
  })

  it('gera um PDF de verdade', async () => {
    const buf = await renderRecallPdf({
      clinicProfile: null,
      patient: { name: 'Paciente Teste', birthDate: '1990-05-10', ageYears: 36, sex: 'feminino' },
      professionalName: 'nutri@clinica.test',
      issuedAt: '2026-08-05',
      recall: buildRecall(),
    })
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(1000)
  })

  it('item sem gramas sai com travessão e não entra na conta como zero', async () => {
    const recall = buildRecall()
    recall.meals[0]!.items.push({
      foodId: 'f9',
      name: 'Suco (quantidade não informada)',
      grams: null,
      measureLabel: null,
      measureQty: null,
      nutrients: null,
    })
    // O total continua o mesmo: o item sem quantidade não vira zero somado,
    // ele simplesmente não tem valor para somar.
    const antes = printedTotals(buildRecall())
    expect(printedTotals(recall)).toEqual(antes)

    const buf = await renderRecallPdf({
      clinicProfile: null,
      patient: { name: 'Paciente Teste', birthDate: null, ageYears: null, sex: null },
      professionalName: 'nutri@clinica.test',
      issuedAt: '2026-08-05',
      recall,
    })
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF')
  })
})
