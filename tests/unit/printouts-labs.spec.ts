/**
 * T026 (US4) — quadro de exames laboratoriais.
 *
 * A regra que este arquivo protege é FR-011: **exame sem faixa cadastrada sai
 * sem classificação**. Escrever "normal" onde não há referência afirma o que não
 * se sabe, e num papel entregue ao paciente essa afirmação vira tranquilidade
 * infundada. É o mesmo erro que a 050 já evitou na tela — aqui garantimos que a
 * impressão não o reintroduza.
 */
import { describe, expect, it } from 'vitest'
import { classifyLabResults, type LabRange } from '@/lib/core/labs/classify'
import { classLabel, groupByPanel, rangeLabel } from '@/lib/core/nutrition/printouts/labs-pdf'

const HOJE = '2026-08-05'

function ranges(entries: Record<string, LabRange>): Map<string, LabRange> {
  return new Map(Object.entries(entries))
}

describe('exame sem faixa não recebe situação (T026)', () => {
  const panel = classifyLabResults(
    [
      { analyteKey: 'glicemia_jejum', value: 92, unit: 'mg/dL', measuredAt: HOJE },
      // Colesterol total existe no catálogo mas a fonte não traz limites.
      { analyteKey: 'colesterol_total', value: 240, unit: 'mg/dL', measuredAt: HOJE },
    ],
    ranges({
      glicemia_jejum: { refMin: 70, refMax: 99, unit: 'mg/dL', sourceLabel: null },
    }),
  )

  it('o analito sem faixa é classificado como sem_referencia', () => {
    const col = panel.items.find((i) => i.analyteKey === 'colesterol_total')
    expect(col?.class).toBe('sem_referencia')
  })

  it('e imprime travessão, não "dentro da faixa"', () => {
    // 240 mg/dL é um valor alto de colesterol. Sem faixa cadastrada, o papel
    // não pode dizer nem que está alto nem que está normal.
    expect(classLabel('sem_referencia')).toBe('—')
    expect(classLabel('normal')).toBe('Dentro da faixa')
  })

  it('a coluna de referência também sai vazia, não "0 – 0"', () => {
    expect(rangeLabel(null, null)).toBe('—')
  })

  it('o exame com faixa continua classificado normalmente', () => {
    const gli = panel.items.find((i) => i.analyteKey === 'glicemia_jejum')
    expect(gli?.class).toBe('normal')
    expect(rangeLabel(gli!.refMin, gli!.refMax)).toBe('70 – 99')
  })
})

describe('faixas de um limite só', () => {
  it('exame só com teto imprime "até X"', () => {
    // Triglicérides ≤ 100: não existe piso, e inventar um marcaria como baixo
    // um resultado excelente.
    expect(rangeLabel(null, 100)).toBe('até 100')
  })

  it('exame só com piso imprime "a partir de X"', () => {
    expect(rangeLabel(50, null)).toBe('a partir de 50')
  })
})

describe('agrupamento por painel', () => {
  it('respeita a ordem do catálogo e não cria painel vazio', () => {
    const panel = classifyLabResults(
      [
        { analyteKey: 'ldl', value: 130, unit: 'mg/dL', measuredAt: HOJE },
        { analyteKey: 'glicemia_jejum', value: 92, unit: 'mg/dL', measuredAt: HOJE },
      ],
      ranges({}),
    )
    const grupos = groupByPanel(panel.items)
    // Metabolismo da Glicose vem antes de Perfil Lipídico no catálogo, e
    // nenhum dos outros painéis do catálogo aparece sem resultado.
    expect(grupos.map((g) => g.group)).toEqual(['Metabolismo da Glicose', 'Perfil Lipídico'])
    expect(grupos.every((g) => g.items.length > 0)).toBe(true)
  })
})

describe('o quadro traz o resultado mais recente de cada analito', () => {
  it('uma coleta nova substitui a antiga, sem duplicar a linha', () => {
    const panel = classifyLabResults(
      [
        { analyteKey: 'glicemia_jejum', value: 130, unit: 'mg/dL', measuredAt: '2026-01-10' },
        { analyteKey: 'glicemia_jejum', value: 92, unit: 'mg/dL', measuredAt: '2026-08-01' },
      ],
      ranges({ glicemia_jejum: { refMin: 70, refMax: 99, unit: 'mg/dL', sourceLabel: null } }),
    )
    expect(panel.items).toHaveLength(1)
    expect(panel.items[0]?.value).toBe(92)
    expect(panel.items[0]?.class).toBe('normal')
  })
})
