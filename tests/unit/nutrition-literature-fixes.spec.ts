/**
 * Feature 046 — trava as correções feitas após a conferência das equações
 * contra a literatura primária (2026-07-20).
 *
 * Cada caso aqui nasceu de uma divergência REAL encontrada entre o código e a
 * publicação original. O objetivo não é cobertura — é impedir regressão
 * silenciosa de valores que já estiveram errados em produção.
 */
import { describe, expect, it } from 'vitest'
import { computeComposition } from '@/lib/core/nutrition/body-composition'
import { computeEnergy } from '@/lib/core/nutrition/energy'
import { compositionAdvisories, energyAdvisories } from '@/lib/core/nutrition/advisories'
import { TMB_EQUATIONS } from '@/lib/core/nutrition/protocols'

describe('EER/IOM 2005 — fator de atividade (PA) deixa de ser ignorado', () => {
  const base = {
    sex: 'M' as const,
    ageYears: 30,
    weightKg: 80,
    heightCm: 180,
    equation: 'eer_iom_2005' as const,
  }

  it('sedentário (categoria 1) usa PA 1.00', () => {
    const r = computeEnergy({ ...base, eerCategory: 1 })
    expect(r.tmbKcal).toBe(2620)
  })

  it('ativo (categoria 3) usa PA 1.25 — antes caía em 1.00 e perdia ~561 kcal', () => {
    const r = computeEnergy({ ...base, eerCategory: 3 })
    expect(r.tmbKcal).toBe(3181)
    // A regressão que esta suíte existe para impedir:
    expect(r.tmbKcal).not.toBe(2620)
  })

  it('as tabelas de PA diferem por sexo', () => {
    // Adulto: ativo → M 1.25, F 1.27.
    const m = computeEnergy({ ...base, sex: 'M', eerCategory: 3 })
    const f = computeEnergy({ ...base, sex: 'F', eerCategory: 3 })
    expect(m.tmbKcal).not.toBe(f.tmbKcal)
  })

  it('PA explícito tem precedência sobre a categoria', () => {
    const r = computeEnergy({ ...base, eerCategory: 1, eerPa: 1.48 })
    expect(r.tmbKcal).toBeGreaterThan(3300)
  })
})

/**
 * ATUALIZADO em 2026-08-03. A conferência de julho tinha trocado o Petroski
 * masculino para a quadrática publicada. Ao comparar com o documento de base da
 * clínica (Evonut.xlsm, Calc_Antropometria), o usuário decidiu seguir a
 * planilha: ela aplica a MESMA equação logarítmica aos dois sexos, e o que muda
 * entre eles são os sítios. O mesmo vale para Durnin (coeficiente agrupado) e
 * Weltman (uma única circunferência).
 */
describe('Petroski — mesma equação nos dois sexos, como no documento de base', () => {
  const skinfolds = { triceps: 10, subescapular: 12, suprailiaca: 14, panturrilha: 9 }

  it('homem: usa a logarítmica, igual à mulher (só os sítios diferem)', () => {
    const r = computeComposition({
      sex: 'M',
      ageYears: 30,
      weightKg: 80,
      heightCm: 180,
      protocol: 'petroski',
      skinfolds,
      circumferences: {},
      fatPctInput: null,
    })
    // Σ = 45; a planilha usa a logarítmica para os dois sexos.
    const S = 45
    const dc = 1.1954713 - 0.07513507 * Math.log10(S) - 0.00041072 * 30
    // O motor arredonda a densidade em 5 casas.
    expect(r.bodyDensity).toBeCloseTo(dc, 4)
  })

  it('mulher: a mesma logarítmica, com os sítios femininos', () => {
    const r = computeComposition({
      sex: 'F',
      ageYears: 30,
      weightKg: 65,
      heightCm: 165,
      protocol: 'petroski',
      skinfolds: { axilar_media: 10, suprailiaca: 14, coxa: 20, panturrilha: 11 },
      circumferences: {},
      fatPctInput: null,
    })
    const S = 55
    const dc = 1.1954713 - 0.07513507 * Math.log10(S) - 0.00041072 * 30
    expect(r.bodyDensity).toBeCloseTo(dc, 4)
  })
})

describe('Slaughter — constante do pré-púbere é a publicada (−1,7)', () => {
  it('menino ≤12 anos com Σ ≤ 35 usa −1.7 (antes: −2.6, valor não publicado)', () => {
    const r = computeComposition({
      sex: 'M',
      ageYears: 11,
      weightKg: 38,
      heightCm: 145,
      protocol: 'slaughter',
      skinfolds: { triceps: 12, subescapular: 10 },
      circumferences: {},
      fatPctInput: null,
    })
    const S = 22
    // O motor arredonda o %gordura em 2 casas.
    expect(r.fatPct).toBeCloseTo(1.21 * S - 0.008 * S * S - 1.7, 2)
  })
})

describe('Durnin-Womersley — coeficiente agrupado, como no documento de base', () => {
  const mk = (ageYears: number) =>
    computeComposition({
      sex: 'M',
      ageYears,
      weightKg: 80,
      heightCm: 180,
      protocol: 'durnin_womersley',
      skinfolds: { biceps: 6, triceps: 10, subescapular: 12, suprailiaca: 14 },
      circumferences: {},
      fatPctInput: null,
    })

  it('usa o agrupado (1,1765 H / 1,1567 M) em qualquer idade', () => {
    // Σ = 42; agrupado masculino: 1.1765 − 0.0744·log10(42)
    const dc = 1.1765 - 0.0744 * Math.log10(42)
    expect(mk(25).bodyDensity).toBeCloseTo(dc, 4)
  })

  it('idades diferentes dão a MESMA densidade — o coeficiente não varia', () => {
    // É a consequência de seguir a planilha: a idade não entra nesta equação.
    expect(mk(25).bodyDensity).toBe(mk(55).bodyDensity)
  })

  it('adolescente usa o mesmo coeficiente, e o aviso de faixa permanece', () => {
    const dc = 1.1765 - 0.0744 * Math.log10(42)
    expect(mk(14).bodyDensity).toBeCloseTo(dc, 4)
    expect(
      compositionAdvisories({ protocol: 'durnin_womersley', sex: 'M', ageYears: 14 }).map(
        (a) => a.code,
      ),
    ).toContain('DURNIN_BELOW_RANGE')
  })

  it('dentro da faixa NÃO avisa', () => {
    expect(
      compositionAdvisories({ protocol: 'durnin_womersley', sex: 'M', ageYears: 30 }).map(
        (a) => a.code,
      ),
    ).not.toContain('DURNIN_BELOW_RANGE')
  })
})

describe('Weltman — uma única circunferência abdominal', () => {
  const mk = (circumferences: Record<string, number>) =>
    computeComposition({
      sex: 'M',
      ageYears: 40,
      weightKg: 95,
      heightCm: 175,
      protocol: 'weltman',
      skinfolds: {},
      circumferences,
      fatPctInput: null,
    })

  it('usa a medida informada; um segundo valor é ignorado', () => {
    // O documento de base pede UMA circunferência. Um `abdomen2` que sobre de
    // avaliação antiga não pode mudar o resultado pelas costas.
    const comExtra = mk({ abdomen: 100, abdomen2: 110 })
    const so = mk({ abdomen: 100 })
    expect(comExtra.fatPct).toBe(so.fatPct)
  })

  it('com uma medida só, usa ela e avisa', () => {
    expect(mk({ abdomen: 100 }).fatPct).toBeGreaterThan(0)
    expect(
      compositionAdvisories({
        protocol: 'weltman',
        sex: 'M',
        ageYears: 40,
        hasSecondAbdomen: false,
      }).map((a) => a.code),
    ).toContain('WELTMAN_SINGLE_ABDOMEN')
  })

  it('com as duas informadas, não avisa sobre medida única', () => {
    expect(
      compositionAdvisories({
        protocol: 'weltman',
        sex: 'M',
        ageYears: 40,
        hasSecondAbdomen: true,
      }).map((a) => a.code),
    ).not.toContain('WELTMAN_SINGLE_ABDOMEN')
  })
})

describe('Rótulos: Cunningham 1980 e 1991 na mesma linhagem', () => {
  it('"Katch-McArdle" é rotulada como Cunningham (1991)', () => {
    expect(TMB_EQUATIONS.katch_mcardle.label).toContain('Cunningham (1991)')
    expect(TMB_EQUATIONS.cunningham.label).toContain('Cunningham (1980)')
  })

  it('toda equação declara a fonte para exibição', () => {
    for (const eq of Object.values(TMB_EQUATIONS)) {
      expect(eq.source, `sem fonte: ${eq.slug}`).toBeTruthy()
    }
  })
})

describe('Avisos de domínio de validação (não bloqueiam o cálculo)', () => {
  it('McArdle fora de 9–16 anos avisa', () => {
    const a = compositionAdvisories({ protocol: 'mcardle', sex: 'M', ageYears: 40 })
    expect(a.map((x) => x.code)).toContain('MCARDLE_OUT_OF_RANGE')
  })

  it('McArdle dentro da faixa não avisa', () => {
    const a = compositionAdvisories({ protocol: 'mcardle', sex: 'M', ageYears: 12 })
    expect(a.map((x) => x.code)).not.toContain('MCARDLE_OUT_OF_RANGE')
  })

  it('Henry-Rees fora de 3–60 anos avisa', () => {
    expect(energyAdvisories({ equation: 'henry_rees', ageYears: 75 }).map((x) => x.code)).toContain(
      'HENRY_REES_OUT_OF_RANGE',
    )
  })

  it('FAO 2004 e Schofield avisam que são equivalentes em adulto', () => {
    expect(energyAdvisories({ equation: 'schofield', ageYears: 30 }).map((x) => x.code)).toContain(
      'FAO2004_SCHOFIELD_SAME',
    )
  })

  it('Tinsley avisa sobre a população de origem', () => {
    expect(
      energyAdvisories({ equation: 'tinsley_mlg', ageYears: 30 }).map((x) => x.code),
    ).toContain('TINSLEY_ATHLETES')
  })

  it('McArdle na faixa válida ainda assim calcula (aviso não bloqueia)', () => {
    const r = computeComposition({
      sex: 'M',
      ageYears: 40,
      weightKg: 80,
      heightCm: 180,
      protocol: 'mcardle',
      skinfolds: { triceps: 15, subescapular: 20 },
      circumferences: {},
      fatPctInput: null,
    })
    expect(r.fatPct).toBeGreaterThan(0)
  })
})
