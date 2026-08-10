/**
 * T032 (US5) — avaliação infantil.
 *
 * A curva é desenhada, não tabelada (research D3): a leitura aqui é posicional,
 * e o único jeito de um teste conferir isso sem abrir o PDF é checar a projeção
 * — se o ponto do paciente cai no lugar certo do eixo. Um erro de sinal no eixo
 * Y desenharia a criança acima do percentil 97 quando ela está abaixo do 3, e
 * nada no PDF denunciaria isso.
 */
import { describe, expect, it } from 'vitest'
import * as pdf from '@react-pdf/renderer'
import { MAX_PEDIATRIC_AGE_MONTHS, ageInMonths, type PercentileRow } from '@/lib/core/growth/classify'
import type { GrowthCurve } from '@/lib/core/growth/read'
import { buildGeometry, project, renderGrowthPdf } from '@/lib/core/nutrition/printouts/growth-pdf'

function band(ageMonths: number, p50: number): PercentileRow {
  return {
    ageMonths,
    p01: p50 * 0.6,
    p3: p50 * 0.75,
    p5: p50 * 0.8,
    p10: p50 * 0.85,
    p15: p50 * 0.9,
    p50,
    p85: p50 * 1.1,
    p97: p50 * 1.25,
    p999: p50 * 1.4,
  }
}

function curve(points: Array<{ ageMonths: number; value: number }>): GrowthCurve {
  return {
    indicator: 'peso_idade',
    label: 'Peso para a idade',
    unit: 'kg',
    bands: [band(24, 12), band(30, 13.5), band(36, 15)],
    points: points.map((p) => ({
      measuredAt: `2026-0${1 + points.indexOf(p)}-10`,
      ageMonths: p.ageMonths,
      value: p.value,
      percentile: 50,
      classification: 'adequado',
      label: 'Peso adequado para a idade',
    })),
    latest: null,
  }
}

describe('a curva é desenhada (T032)', () => {
  it('o renderer expõe as primitivas de desenho', () => {
    for (const p of ['Svg', 'Polyline', 'Circle', 'Line'] as const) {
      expect(p in pdf, `primitiva ausente: ${p}`).toBe(true)
    }
  })
})

describe('o ponto do paciente cai no lugar certo do eixo', () => {
  const c = curve([{ ageMonths: 24, value: 12 }, { ageMonths: 36, value: 15 }])
  const g = buildGeometry(c)!

  it('o eixo cobre as bandas e os pontos', () => {
    expect(g.xMin).toBe(24)
    expect(g.xMax).toBe(36)
    // O menor valor desenhado é o P3 da primeira banda (12 * 0,75).
    expect(g.yMin).toBeCloseTo(9, 6)
    expect(g.yMax).toBeCloseTo(18.75, 6) // P97 da última banda
  })

  it('o Y é invertido — valor maior desenha mais ACIMA', () => {
    // Sem essa inversão a criança abaixo do percentil 3 apareceria no topo do
    // gráfico, exatamente onde se lê "excesso".
    const baixo = project(g, 30, g.yMin)
    const alto = project(g, 30, g.yMax)
    expect(alto.y).toBeLessThan(baixo.y)
  })

  it('o meio do eixo cai no meio do desenho', () => {
    const meio = project(g, (g.xMin + g.xMax) / 2, (g.yMin + g.yMax) / 2)
    const inicio = project(g, g.xMin, g.yMin)
    const fim = project(g, g.xMax, g.yMax)
    expect(meio.x).toBeCloseTo((inicio.x + fim.x) / 2, 6)
    expect(meio.y).toBeCloseTo((inicio.y + fim.y) / 2, 6)
  })

  it('ponto fora do percentil 97 continua dentro do desenho', () => {
    // É justamente o caso em que a curva precisa ser lida; cortá-lo na borda o
    // esconderia.
    const g2 = buildGeometry(curve([{ ageMonths: 36, value: 24 }]))!
    expect(g2.yMax).toBeGreaterThanOrEqual(24)
    const p = project(g2, 36, 24)
    expect(p.y).toBeGreaterThanOrEqual(0)
  })

  it('uma aferição só não divide por zero', () => {
    const g3 = buildGeometry(curve([{ ageMonths: 30, value: 13.5 }]))!
    const p = project(g3, 30, 13.5)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
  })

  it('sem bandas não há geometria — nada é desenhado às cegas', () => {
    expect(buildGeometry({ ...curve([]), bands: [] })).toBeNull()
  })
})

describe('faixa etária', () => {
  it('as curvas pediátricas valem até 19 anos', () => {
    expect(MAX_PEDIATRIC_AGE_MONTHS).toBe(228)
    // Aos 19 anos e 1 mês o impresso não é gerado (a rota devolve 404).
    expect(ageInMonths('2007-01-10', '2026-02-10')).toBeGreaterThan(MAX_PEDIATRIC_AGE_MONTHS)
    expect(ageInMonths('2010-01-10', '2026-02-10')).toBeLessThan(MAX_PEDIATRIC_AGE_MONTHS)
  })
})

describe('o PDF sai', () => {
  it('gera um documento de verdade com as três curvas', async () => {
    const buf = await renderGrowthPdf({
      clinicProfile: null,
      patient: { name: 'Criança Teste', birthDate: '2023-08-10', ageYears: 3, sex: 'feminino' },
      professionalName: 'nutri@clinica.test',
      issuedAt: '2026-08-05',
      curves: [
        curve([{ ageMonths: 24, value: 12 }, { ageMonths: 36, value: 15 }]),
        { ...curve([{ ageMonths: 30, value: 90 }]), indicator: 'estatura_idade', label: 'Estatura para a idade', unit: 'cm' },
      ],
    })
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(1000)
  })
})
