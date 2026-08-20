/**
 * T024 (Feature 046) — equações de gasto energético vs. gabarito.
 *
 * Gabaritos calculados a partir das fórmulas (coeficientes canônicos onde a
 * planilha divergia — ver nutri-doc/formulas-referencia.md). Caso base:
 * M, 30 anos, 80 kg, 180 cm, MLG 64 kg.
 */
import { describe, it, expect } from 'vitest'
import {
  computeEnergy,
  computeTmb,
  computeGet,
  type EnergyInput,
} from '@/lib/core/nutrition/energy'
import { NutritionInputError } from '@/lib/core/nutrition/body-composition'

const base: EnergyInput = {
  sex: 'M',
  ageYears: 30,
  weightKg: 80,
  heightCm: 180,
  leanMassKg: 64,
  equation: 'mifflin',
}

describe('Feature 046 — TMB por equação', () => {
  const cases: { eq: EnergyInput['equation']; expected: number }[] = [
    { eq: 'mifflin', expected: 1782 }, // 9.99·80 + 6.25·180 − 4.92·30 + 5
    { eq: 'harris_benedict_1984', expected: 1854 },
    { eq: 'harris_benedict_1919', expected: 1865 },
    { eq: 'katch_mcardle', expected: 1752 }, // 370 + 21.6·64
    { eq: 'cunningham', expected: 1908 }, // 500 + 22·64
    { eq: 'tinsley_peso', expected: 1994 }, // 24.8·80 + 10
    { eq: 'tinsley_mlg', expected: 1942 }, // 25.9·64 + 284
    { eq: 'fao_who_1985', expected: 1807 }, // 11.6·80 + 879
    { eq: 'fao_who_2004', expected: 1791 }, // 11.472·80 + 873.1
    { eq: 'schofield', expected: 1791 }, // (0.048·80 + 3.653)·239
    { eq: 'henry_rees', expected: 1635 }, // (0.046·80 + 3.16)·239
  ]
  for (const c of cases) {
    it(`${c.eq} → ${c.expected} kcal`, () => {
      expect(Math.round(computeTmb({ ...base, equation: c.eq }))).toBe(c.expected)
    })
  }

  it('EER/IOM 2005 adulto (PA 1.0) já é total', () => {
    // 662 − 9.53·30 + (15.91·80 + 539.6·1.8) = 2620
    expect(Math.round(computeTmb({ ...base, equation: 'eer_iom_2005', eerPa: 1.0 }))).toBe(2620)
  })

  it('EER 2023 adulto categoria 1', () => {
    // 753.07 − 10.83·30 + 6.5·180 + 14.1·80 = 2726
    expect(Math.round(computeTmb({ ...base, equation: 'eer_2023', eerCategory: 1 }))).toBe(2726)
  })
})

describe('Feature 046 — GET, VET e macros', () => {
  it('GET clássico = TMB × PAL × injúria (+extra)', () => {
    const tmb = computeTmb(base) // 1780
    expect(Math.round(computeGet({ ...base, activityFactor: 1.55 }, tmb))).toBe(2761)
  })

  it('EER: GET = o próprio valor EER (injúria 1)', () => {
    const eer = computeTmb({ ...base, equation: 'eer_iom_2005', eerPa: 1.0 })
    expect(Math.round(computeGet({ ...base, equation: 'eer_iom_2005' }, eer))).toBe(2620)
  })

  it('VET-meta e macros a partir do objetivo', () => {
    const r = computeEnergy({
      ...base,
      activityFactor: 1.55,
      objective: 'deficit',
      objectiveDeltaKcal: -500,
      macros: { protPct: 30, carbPct: 40, lipPct: 30 },
    })
    expect(r.getKcal).toBe(2761)
    expect(r.targetKcal).toBe(2261)
    expect(r.macros?.protG).toBe(170) // 2261·0.3/4
    expect(r.macros?.carbG).toBe(226) // 2259·0.4/4
    expect(r.macros?.lipG).toBe(75) // 2259·0.3/9
  })

  it('macros que não somam 100% são rejeitados', () => {
    expect(() =>
      computeEnergy({
        ...base,
        activityFactor: 1.2,
        macros: { protPct: 30, carbPct: 30, lipPct: 30 },
      }),
    ).toThrow(/100%/)
  })
})

describe('Feature 046 — validações do motor', () => {
  it('Katch-McArdle sem massa magra → MISSING_LEAN_MASS', () => {
    expect(() => computeTmb({ ...base, equation: 'katch_mcardle', leanMassKg: null })).toThrow(
      NutritionInputError,
    )
  })

  it('equação de gestante para homem → EQUATION_FEMALE_ONLY', () => {
    expect(() => computeEnergy({ ...base, equation: 'eer_gestante' })).toThrow(/mulheres/i)
  })
})

/**
 * Conferência contra a planilha de referência (`nutri-doc/Evonut.xlsm`, aba
 * Calc_GastoEnerg, colunas Masculino/Feminino). Os coeficientes foram lidos das
 * fórmulas do arquivo, não digitados de memória.
 */
describe('coeficientes conferidos contra a planilha de referência', () => {
  const P = 80
  const A = 175
  const I = 40

  it('Mifflin usa os coeficientes do artigo (9,99 e 4,92), não os arredondados', () => {
    // A planilha traz 9.99*P + 6.25*A - 4.92*I ± termo de sexo. O sistema vinha
    // com 10 e 5, que circulam em livro-texto mas não são os publicados.
    const m = computeTmb({ sex: 'M', ageYears: I, weightKg: P, heightCm: A, equation: 'mifflin' })
    const f = computeTmb({ sex: 'F', ageYears: I, weightKg: P, heightCm: A, equation: 'mifflin' })
    expect(m).toBeCloseTo(9.99 * P + 6.25 * A - 4.92 * I + 5, 6)
    expect(f).toBeCloseTo(9.99 * P + 6.25 * A - 4.92 * I - 161, 6)
    // E são distintos por sexo: 166 kcal de diferença.
    expect(m - f).toBeCloseTo(166, 6)
  })

  it('Harris-Benedict mantém a precisão da publicação e difere por sexo', () => {
    const m = computeTmb({
      sex: 'M',
      ageYears: I,
      weightKg: P,
      heightCm: A,
      equation: 'harris_benedict_1984',
    })
    const f = computeTmb({
      sex: 'F',
      ageYears: I,
      weightKg: P,
      heightCm: A,
      equation: 'harris_benedict_1984',
    })
    expect(m).toBeCloseTo(88.362 + 13.397 * P + 4.799 * A - 5.677 * I, 6)
    expect(f).toBeCloseTo(447.593 + 9.247 * P + 3.098 * A - 4.33 * I, 6)
    expect(m).not.toBeCloseTo(f, 0)
  })

  it('FAO/WHO, Schofield e Henry-Rees batem com a planilha nas duas colunas', () => {
    const casos: Array<[Parameters<typeof computeTmb>[0]['equation'], number, number]> = [
      // [equação, esperado M, esperado F] para 80 kg / 175 cm / 40 anos.
      ['fao_who_1985', 11.6 * P + 879, 8.7 * P + 829],
      ['fao_who_2004', 11.472 * P + 873.1, 8.126 * P + 845.6],
      ['schofield', (0.048 * P + 3.653) * 239, (0.034 * P + 3.538) * 239],
      ['henry_rees', (0.046 * P + 3.16) * 239, (0.048 * P + 2.448) * 239],
    ]
    for (const [eq, esperadoM, esperadoF] of casos) {
      expect(
        computeTmb({ sex: 'M', ageYears: I, weightKg: P, heightCm: A, equation: eq }),
        `${eq} masculino`,
      ).toBeCloseTo(esperadoM, 6)
      expect(
        computeTmb({ sex: 'F', ageYears: I, weightKg: P, heightCm: A, equation: eq }),
        `${eq} feminino`,
      ).toBeCloseTo(esperadoF, 6)
    }
  })

  it('a variante da planilha do EER 2005 difere da publicada e é menor', () => {
    const base = { ageYears: I, weightKg: P, heightCm: A, eerCategory: 3 as const }
    const oficialM = computeTmb({ ...base, sex: 'M', equation: 'eer_iom_2005' })
    const planilhaM = computeTmb({ ...base, sex: 'M', equation: 'eer_iom_2005_planilha' })

    // Na planilha o fator de atividade NÃO multiplica a altura, e há +107 fixo.
    const pa = 1.25
    expect(planilhaM).toBeCloseTo(662 - 9.53 * I + pa * (15.91 * P) + 539.6 * 1.75 + 107, 6)
    // Diferença material, mas menor do que eu havia estimado: no ADULTO o termo
    // de altura é 539,6 (não 903, que é o pediátrico), então dá ~129 kcal com
    // PA 1,25. Em criança a distância é bem maior.
    expect(oficialM - planilhaM).toBeGreaterThan(100)
    expect(oficialM - planilhaM).toBeLessThan(200)

    const planilhaF = computeTmb({ ...base, sex: 'F', equation: 'eer_iom_2005_planilha' })
    expect(planilhaF).toBeCloseTo(354 - 6.91 * I + 1.27 * (9.36 * P) + 726 * 1.75 + 144, 6)
    // Aditivo distinto por sexo: 107 no homem, 144 na mulher.
    expect(planilhaM).not.toBeCloseTo(planilhaF, 0)
  })
})

describe('fatores de injúria conferidos contra o documento de base', () => {
  it('traz as 25 condições, e as duas que REDUZEM o gasto estão entre elas', async () => {
    const { INJURY_FACTORS } = await import('@/lib/core/nutrition/protocols')
    expect(INJURY_FACTORS.length).toBe(25)

    // O catálogo antigo omitia exatamente estas duas — os únicos casos em que o
    // gasto cai. Sem elas, o cálculo só sabia aumentar.
    const abaixoDeUm = INJURY_FACTORS.filter((f) => f.value < 1)
    expect(abaixoDeUm.map((f) => f.label).sort()).toEqual([
      'Doença cardiopulmonar',
      'Jejum ou inanição',
    ])
    expect(abaixoDeUm.find((f) => f.label === 'Doença cardiopulmonar')?.value).toBe(0.9)
    expect(abaixoDeUm.find((f) => f.label === 'Jejum ou inanição')?.value).toBe(0.925)
  })

  it('o fator de injúria reduz mesmo o GET quando é menor que 1', () => {
    const base = {
      sex: 'M' as const,
      ageYears: 40,
      weightKg: 80,
      heightCm: 175,
      equation: 'mifflin' as const,
      activityFactor: 1.55,
    }
    const semInjuria = computeEnergy({ ...base, injuryFactor: 1 })
    const cardiopulmonar = computeEnergy({ ...base, injuryFactor: 0.9 })
    expect(cardiopulmonar.getKcal).toBeLessThan(semInjuria.getKcal)
    expect(cardiopulmonar.getKcal).toBe(Math.round(semInjuria.getKcal * 0.9))
  })

  it('os fatores de atividade batem com a coluna da planilha', () => {
    // 1,2 · 1,375 · 1,55 · 1,725 · 1,9
    return import('@/lib/core/nutrition/protocols').then(({ ACTIVITY_FACTORS }) => {
      expect(ACTIVITY_FACTORS.map((a) => a.value)).toEqual([1.2, 1.375, 1.55, 1.725, 1.9])
    })
  })
})
