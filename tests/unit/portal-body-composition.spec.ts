import { describe, expect, it } from 'vitest'
import {
  buildCompositionView,
  type PortalCompositionPoint,
} from '@/lib/core/patient-portal/body-composition'
import { PORTAL_SECTIONS } from '@/lib/core/patient-portal/sections'
import { ALL_MODULES } from '@/lib/core/entitlements/plans'

/**
 * Feature 058 US2/US3 — o que a área de composição corporal afirma ao paciente.
 */

function point(over: Partial<PortalCompositionPoint> = {}): PortalCompositionPoint {
  return {
    id: 'a1',
    assessedAt: '2026-08-14',
    weightKg: 79.5,
    fatPct: 22.4,
    fatMassKg: 17.8,
    leanMassKg: 61.7,
    method: 'bioimpedancia',
    methodLabel: 'Bioimpedância',
    ...over,
  }
}

describe('a leitura da série', () => {
  it('sem avaliação, não há o que mostrar — e nada é inventado', () => {
    const v = buildCompositionView([])
    expect(v.latest).toBeNull()
    expect(v.points).toEqual([])
    expect(v.methodLabels).toEqual([])
    expect(v.hasTrend).toBe(false)
  })

  it('a mais recente é a ÚLTIMA da série (ordem cronológica ascendente)', () => {
    const v = buildCompositionView([
      point({ id: 'velha', assessedAt: '2026-03-02', fatPct: 26 }),
      point({ id: 'nova', assessedAt: '2026-08-14', fatPct: 22.4 }),
    ])
    expect(v.latest?.id).toBe('nova')
    expect(v.latest?.fatPct).toBe(22.4)
  })

  it('um ponto NÃO é evolução — nenhuma tendência é afirmada', () => {
    expect(buildCompositionView([point()]).hasTrend).toBe(false)
    expect(buildCompositionView([point(), point({ id: 'b' })]).hasTrend).toBe(true)
  })
})

describe('FR-012 — o método anda junto de cada leitura', () => {
  it('coleta os métodos distintos, na ordem em que aparecem', () => {
    const v = buildCompositionView([
      point({ id: '1', method: 'durnin_womersley', methodLabel: 'Durnin & Womersley (1974)' }),
      point({ id: '2', method: 'durnin_womersley', methodLabel: 'Durnin & Womersley (1974)' }),
      point({ id: '3', method: 'bioimpedancia', methodLabel: 'Bioimpedância' }),
    ])
    expect(v.methodLabels).toEqual(['Durnin & Womersley (1974)', 'Bioimpedância'])
  })

  it('um método só não gera aviso de incomparabilidade', () => {
    const v = buildCompositionView([point({ id: '1' }), point({ id: '2' })])
    expect(v.methodLabels).toHaveLength(1)
  })

  it('avaliação sem método não some da série nem inventa um rótulo', () => {
    const v = buildCompositionView([point({ method: null, methodLabel: null })])
    expect(v.points).toHaveLength(1)
    expect(v.latest?.methodLabel).toBeNull()
    expect(v.methodLabels).toEqual([])
  })
})

describe('FR-014 — ausência nunca vira zero', () => {
  it('valor não apurado continua nulo, e não é substituído por 0', () => {
    const v = buildCompositionView([
      point({ fatMassKg: null, leanMassKg: null, weightKg: null, fatPct: 19.2 }),
    ])
    expect(v.latest?.fatMassKg).toBeNull()
    expect(v.latest?.leanMassKg).toBeNull()
    expect(v.latest?.weightKg).toBeNull()
    expect(v.latest?.fatPct).toBe(19.2)
  })
})

describe('FR-013 — nada é recalculado', () => {
  it('os valores saem exatamente como a avaliação os gravou', () => {
    // Massas propositalmente INCOERENTES com o peso: se algum dia a tela
    // passar a "corrigir" o snapshot, este teste quebra — que é o ponto.
    const v = buildCompositionView([
      point({ weightKg: 80, fatMassKg: 15, leanMassKg: 60, fatPct: 21 }),
    ])
    expect(v.latest).toMatchObject({ weightKg: 80, fatMassKg: 15, leanMassKg: 60, fatPct: 21 })
  })
})

describe('US3 — módulo e catálogo de seções', () => {
  const secao = PORTAL_SECTIONS.find((s) => s.key === 'composicao')!

  it('a área existe no catálogo e está implementada', () => {
    expect(secao).toBeDefined()
    expect(secao.implemented).toBe(true)
  })

  it('exige um módulo que a plataforma de fato liga por clínica (FR-016)', () => {
    expect(secao.requiredModule).toBe('nutri_avaliacao')
    expect(ALL_MODULES).toContain('nutri_avaliacao')
  })

  it('nasce DESLIGADA — a clínica opta por expor dado clínico', () => {
    expect(secao.defaultEnabled).toBe(false)
  })

  it('fica logo depois de "Minha evolução", que é a área irmã', () => {
    const metricas = PORTAL_SECTIONS.find((s) => s.key === 'metricas')!
    const orientacoes = PORTAL_SECTIONS.find((s) => s.key === 'orientacoes')!
    expect(secao.order).toBeGreaterThan(metricas.order)
    expect(secao.order).toBeLessThan(orientacoes.order)
  })
})
