/**
 * T001, T005 — fundação dos impressos.
 *
 * Dois pontos que só um teste segura: a distinção entre "é zero" e "não sei",
 * que se perde na primeira refatoração desatenta; e a existência das primitivas
 * SVG, sem as quais a curva de crescimento quebra em silêncio numa atualização
 * de dependência.
 */
import { describe, expect, it } from 'vitest'
import * as pdf from '@react-pdf/renderer'
import { ageAt, brDate, dash, fmt } from '@/lib/core/nutrition/printouts/shared'
import {
  MAX_EVOLUTION_COLUMNS,
  pickEvolutionColumns,
  type EvolutionColumn,
} from '@/lib/pdf/evolution-columns'

describe('primitivas do renderer (T001)', () => {
  it('expõe o necessário para desenhar a curva de crescimento', () => {
    // research D3: recharts não serve (é React DOM). Se uma atualização remover
    // estas primitivas, o impresso infantil quebra sem aviso.
    for (const p of ['Svg', 'Polyline', 'Circle', 'Line', 'Path'] as const) {
      expect(p in pdf, `primitiva ausente: ${p}`).toBe(true)
    }
  })
})

describe('ausência não é zero', () => {
  it('nulo, indefinido e NaN viram travessão', () => {
    expect(dash(null)).toBe('—')
    expect(dash(undefined)).toBe('—')
    expect(dash(Number.NaN)).toBe('—')
    expect(dash('')).toBe('—')
  })

  it('o zero de verdade permanece zero', () => {
    // "não comeu gordura nenhuma" é uma afirmação; "não medimos" é a ausência
    // dela. Confundi-las num papel entregue ao paciente é declarar o que não
    // se sabe.
    expect(dash(0)).toBe('0')
    expect(fmt(0, 'g')).toBe('0 g')
  })

  it('valor ausente não carrega a unidade pendurada', () => {
    expect(fmt(null, 'g')).toBe('—')
    expect(fmt(12.5, 'g')).toBe('12,5 g')
  })

  it('data vazia também vira travessão', () => {
    expect(brDate(null)).toBe('—')
    expect(brDate('2026-08-03')).toBe('03/08/2026')
    expect(brDate('2026-08-03T10:00:00Z')).toBe('03/08/2026')
  })
})

describe('idade na data de emissão', () => {
  it('conta anos completos', () => {
    expect(ageAt('1990-08-03', '2026-08-03')).toBe(36)
    expect(ageAt('1990-08-04', '2026-08-03')).toBe(35)
  })

  it('sem nascimento devolve null em vez de zero', () => {
    expect(ageAt(null, '2026-08-03')).toBeNull()
  })
})

const col = (assessedAt: string): EvolutionColumn => ({
  assessedAt,
  protocol: 'Dobras',
  cells: [],
})

describe('colunas de evolução', () => {
  it('usa as três mais recentes, da mais antiga para a mais nova', () => {
    const escolhidas = pickEvolutionColumns([
      col('2026-01-10'),
      col('2026-08-01'),
      col('2026-03-15'),
      col('2026-06-20'),
      col('2025-12-01'),
    ])
    expect(escolhidas.map((c) => c.assessedAt)).toEqual(['2026-03-15', '2026-06-20', '2026-08-01'])
  })

  it('com menos de três, devolve só as que existem', () => {
    // Coluna vazia sugeriria histórico que não há — o paciente leria como
    // "não fui medido naquele mês".
    expect(pickEvolutionColumns([col('2026-08-01')])).toHaveLength(1)
    expect(pickEvolutionColumns([])).toHaveLength(0)
  })

  it('o padrão de três colunas é o da planilha de referência', () => {
    expect(MAX_EVOLUTION_COLUMNS).toBe(3)
  })
})
