import { describe, expect, it } from 'vitest'
import {
  FRONT_OF_PACK,
  FRONT_OF_PACK_LABEL,
  FRONT_OF_PACK_NUTRIENTS,
  LABEL_NUTRIENTS,
  NORMATIVE_VERSION,
  labelNutrient,
} from '@/lib/core/nutrition/labeling/reference'
import { micronutrientDef } from '@/lib/core/nutrition/micronutrients'

/**
 * Feature 052 (T004) — trava das referências normativas.
 *
 * Estes números vão para embalagem comercial. Um erro aqui não é bug de tela:
 * é declaração irregular. Este teste existe para que qualquer alteração em
 * `reference.ts` seja deliberada e passe por revisão.
 */

/** Os 10 obrigatórios da IN 75/2020, na ordem da norma. */
const OBRIGATORIOS = [
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
]

describe('referências da rotulagem — nutrientes obrigatórios', () => {
  it('declara exatamente os 10 nutrientes obrigatórios, na ordem da norma', () => {
    expect(LABEL_NUTRIENTS.map((n) => n.key)).toEqual(OBRIGATORIOS)
  })

  it('não há chave duplicada', () => {
    const keys = LABEL_NUTRIENTS.map((n) => n.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('a ordem de exibição é única e crescente', () => {
    const orders = LABEL_NUTRIENTS.map((n) => n.order)
    expect(new Set(orders).size).toBe(orders.length)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)
  })

  it('todo nutriente tem rótulo e unidade válida', () => {
    for (const n of LABEL_NUTRIENTS) {
      expect(n.label.trim().length, n.key).toBeGreaterThan(0)
      expect(['kcal', 'g', 'mg'], n.key).toContain(n.unit)
    }
  })
})

describe('referências da rotulagem — valores diários (Anexo II)', () => {
  it('só açúcares totais ficam sem VDR', () => {
    // A norma não estabelece valor diário para açúcares totais; declara-se o
    // valor sem %VD. Qualquer outro nutriente sem VDR seria erro.
    const semVd = LABEL_NUTRIENTS.filter((n) => n.dv === null).map((n) => n.key)
    expect(semVd).toEqual(['acucares_totais'])
  })

  it('crava os VDR da IN 75/2020', () => {
    // Travados de propósito: mudar qualquer um destes números muda o que é
    // impresso numa embalagem. Alteração aqui exige conferência com a norma.
    const esperado: Record<string, number | null> = {
      energia: 2000,
      carboidratos: 300,
      acucares_totais: null,
      acucares_adicionados: 50,
      proteinas: 50,
      gorduras_totais: 65,
      gorduras_saturadas: 20,
      gorduras_trans: 2,
      fibra_alimentar: 25,
      sodio: 2000,
    }
    for (const n of LABEL_NUTRIENTS) {
      expect(n.dv, `VDR de ${n.key}`).toBe(esperado[n.key])
    }
  })

  it('NÃO usa os valores da planilha de origem nem os da norma revogada', () => {
    // A aba "Rótulos Nutricionais" do AF..xlsm usa referências da revogada
    // RDC 360/2003. O caso grave é açúcares adicionados com 300 g em vez de
    // 50 g, que subdeclara o %VD de um produto doce em seis vezes.
    expect(labelNutrient('acucares_adicionados')?.dv).not.toBe(300)
    expect(labelNutrient('proteinas')?.dv).not.toBe(75)
    expect(labelNutrient('gorduras_totais')?.dv).not.toBe(55)
    expect(labelNutrient('gorduras_saturadas')?.dv).not.toBe(22)
    expect(labelNutrient('sodio')?.dv).not.toBe(2400)
  })

  it('todo VDR presente é positivo', () => {
    for (const n of LABEL_NUTRIENTS) {
      if (n.dv !== null) expect(n.dv, n.key).toBeGreaterThan(0)
    }
  })
})

describe('referências da rotulagem — não significativos (Anexo IV)', () => {
  it('crava os limites abaixo dos quais se declara zero', () => {
    // Açúcares adicionados é `null` de propósito: o Anexo IV trata esse
    // nutriente por CRITÉRIO ("sem adição de açúcares"), não por grandeza —
    // conferido no texto oficial em 2026-08-02 (T033).
    const esperado: Record<string, number | null> = {
      energia: 4,
      carboidratos: 0.5,
      acucares_totais: 0.5,
      acucares_adicionados: null,
      proteinas: 0.5,
      gorduras_totais: 0.5,
      gorduras_saturadas: 0.1,
      gorduras_trans: 0.1,
      fibra_alimentar: 0.5,
      sodio: 5,
    }
    for (const n of LABEL_NUTRIENTS) {
      expect(n.insignificantAtOrBelow, `limite de ${n.key}`).toBe(esperado[n.key])
    }
  })
})

describe('referências da rotulagem — origem do dado na base', () => {
  it('toda chave de micronutriente existe no catálogo da 049', () => {
    // Se a 049 renomear uma chave, o rótulo passaria a somar nada em silêncio
    // e o nutriente ficaria eternamente "incompleto". Este teste quebra antes.
    for (const n of LABEL_NUTRIENTS) {
      if (n.source.kind !== 'micro') continue
      expect(micronutrientDef(n.source.key), `micro ausente: ${n.source.key}`).toBeDefined()
    }
  })

  it('os quatro nutrientes específicos de rótulo vêm do JSONB de micros', () => {
    const deMicro = LABEL_NUTRIENTS.filter((n) => n.source.kind === 'micro').map((n) => n.key)
    expect(deMicro.sort()).toEqual(
      ['acucares_adicionados', 'acucares_totais', 'gorduras_saturadas', 'gorduras_trans', 'sodio'].sort(),
    )
  })

  it('energia e macros vêm de colunas diretas de foods', () => {
    const deCampo = LABEL_NUTRIENTS.filter((n) => n.source.kind === 'field').map((n) => n.key)
    expect(deCampo.sort()).toEqual(
      ['carboidratos', 'energia', 'fibra_alimentar', 'gorduras_totais', 'proteinas'].sort(),
    )
  })
})

describe('rotulagem frontal (RDC 429/2020)', () => {
  it('cobre os três nutrientes da lupa', () => {
    expect(FRONT_OF_PACK_NUTRIENTS.sort()).toEqual(
      ['acucares_adicionados', 'gorduras_saturadas', 'sodio'].sort(),
    )
  })

  it('crava os seis limites', () => {
    expect(FRONT_OF_PACK.acucares_adicionados).toEqual({ solido: 15, liquido: 7.5 })
    expect(FRONT_OF_PACK.gorduras_saturadas).toEqual({ solido: 6, liquido: 3 })
    expect(FRONT_OF_PACK.sodio).toEqual({ solido: 600, liquido: 300 })
  })

  it('o limite de líquido é sempre menor que o de sólido', () => {
    for (const n of FRONT_OF_PACK_NUTRIENTS) {
      expect(FRONT_OF_PACK[n].liquido, n).toBeLessThan(FRONT_OF_PACK[n].solido)
    }
  })

  it('todo nutriente da lupa também é declarado na tabela', () => {
    for (const n of FRONT_OF_PACK_NUTRIENTS) {
      expect(labelNutrient(n), `${n} fora da tabela`).toBeDefined()
    }
  })

  it('todo nutriente da lupa tem texto de marca', () => {
    for (const n of FRONT_OF_PACK_NUTRIENTS) {
      expect(FRONT_OF_PACK_LABEL[n]).toMatch(/^ALTO EM /)
    }
  })
})

describe('versão da norma', () => {
  it('identifica as duas normas aplicadas', () => {
    expect(NORMATIVE_VERSION).toContain('IN 75/2020')
    expect(NORMATIVE_VERSION).toContain('RDC 429/2020')
  })
})
