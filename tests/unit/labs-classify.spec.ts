import { describe, expect, it } from 'vitest'
import { classifyLabResults, classifyValue, type LabRange } from '@/lib/core/labs/classify'

/**
 * Feature 050 US1 (T012) — motor de classificação baixo/normal/alto.
 *
 * Puro e isomórfico: a mesma função classifica na tela e no servidor. A leitura
 * é DERIVADA, nunca persistida — corrigir uma faixa reclassifica o histórico.
 */

const range = (refMin: number | null, refMax: number | null): LabRange => ({
  refMin,
  refMax,
  unit: 'mg/dL',
  sourceLabel: 'teste',
})

const result = (analyteKey: string, value: number, measuredAt = '2026-07-20') => ({
  analyteKey,
  value,
  unit: 'mg/dL',
  measuredAt,
})

describe('classifyValue', () => {
  it('classifica abaixo do piso como baixo', () => {
    expect(classifyValue(9, range(10, 20))).toBe('baixo')
  })

  it('classifica acima do teto como alto', () => {
    expect(classifyValue(21, range(10, 20))).toBe('alto')
  })

  it('classifica dentro da faixa como normal', () => {
    expect(classifyValue(15, range(10, 20))).toBe('normal')
  })

  it('trata os limites como INCLUSIVOS (faixa fechada, como o laboratório publica)', () => {
    expect(classifyValue(10, range(10, 20))).toBe('normal')
    expect(classifyValue(20, range(10, 20))).toBe('normal')
  })

  it('faixa só com teto (≤ X) nunca classifica baixo', () => {
    // Caso real da fonte: triglicérides ≤ 100, LDL oxidado ≤ 30.
    const soTeto = range(null, 100)
    expect(classifyValue(0.1, soTeto)).toBe('normal')
    expect(classifyValue(100, soTeto)).toBe('normal')
    expect(classifyValue(101, soTeto)).toBe('alto')
  })

  it('faixa só com piso (≥ X) nunca classifica alto', () => {
    // Caso real da fonte: apo A-I ≥ 130, HDL ≥ 50, zinco ≥ 6,5.
    const soPiso = range(130, null)
    expect(classifyValue(9999, soPiso)).toBe('normal')
    expect(classifyValue(130, soPiso)).toBe('normal')
    expect(classifyValue(129, soPiso)).toBe('baixo')
  })

  it('sem nenhum limite é sem_referencia', () => {
    expect(classifyValue(50, range(null, null))).toBe('sem_referencia')
    expect(classifyValue(50, undefined)).toBe('sem_referencia')
  })

  it('valor não-finito é sem_referencia (não classifica lixo)', () => {
    expect(classifyValue(Number.NaN, range(10, 20))).toBe('sem_referencia')
    expect(classifyValue(Number.POSITIVE_INFINITY, range(10, 20))).toBe('sem_referencia')
  })
})

describe('classifyLabResults', () => {
  it('devolve item por resultado, com a faixa aplicada', () => {
    const ranges = new Map<string, LabRange>([['lab_ferritina', range(70, 200)]])
    const out = classifyLabResults([result('lab_ferritina', 18)], ranges)
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!).toMatchObject({
      analyteKey: 'lab_ferritina',
      value: 18,
      refMin: 70,
      refMax: 200,
      class: 'baixo',
    })
  })

  it('preenche label, grupo e unidade a partir do catálogo', () => {
    const ranges = new Map<string, LabRange>([['lab_ferritina', range(70, 200)]])
    const item = classifyLabResults([result('lab_ferritina', 100)], ranges).items[0]!
    expect(item.label).toBe('Ferritina')
    expect(item.group).toBe('Metabolismo do Ferro')
    expect(item.unit).toBe('mcg/L')
  })

  it('analito ausente do mapa de faixas vira sem_referencia, mas continua listado', () => {
    // FR-007: resultado sem faixa aplicável é REGISTRADO e exibido.
    const out = classifyLabResults([result('lab_ferritina', 18)], new Map())
    expect(out.items[0]!.class).toBe('sem_referencia')
    expect(out.items[0]!.refMin).toBeNull()
    expect(out.items[0]!.refMax).toBeNull()
    expect(out.items[0]!.value).toBe(18)
  })

  it('conta baixos e altos', () => {
    const ranges = new Map<string, LabRange>([
      ['lab_ferritina', range(70, 200)],
      ['lab_hemoglobina', range(13.5, 15.5)],
      ['lab_tsh', range(1, 2.5)],
      ['lab_zinco', range(6.5, null)],
    ])
    const out = classifyLabResults(
      [
        result('lab_ferritina', 18), // baixo
        result('lab_hemoglobina', 14), // normal
        result('lab_tsh', 8), // alto
        result('lab_zinco', 2), // baixo
      ],
      ranges,
    )
    expect(out.low).toBe(2)
    expect(out.high).toBe(1)
  })

  it('ordena os alterados primeiro, normais depois, sem referência por último', () => {
    const ranges = new Map<string, LabRange>([
      ['lab_ferritina', range(70, 200)],
      ['lab_hemoglobina', range(13.5, 15.5)],
      ['lab_tsh', range(1, 2.5)],
    ])
    const out = classifyLabResults(
      [
        result('lab_hemoglobina', 14), // normal
        result('lab_zinco', 5), // sem referência
        result('lab_tsh', 8), // alto
        result('lab_ferritina', 18), // baixo
      ],
      ranges,
    )
    const classes = out.items.map((i) => i.class)
    expect(classes.slice(0, 2).sort()).toEqual(['alto', 'baixo'])
    expect(classes[2]).toBe('normal')
    expect(classes[3]).toBe('sem_referencia')
  })

  it('mantém apenas o resultado mais recente por analito', () => {
    // O painel mostra o último de cada exame (FR-001 cenário 5); a série
    // completa vai separada, para o gráfico.
    const ranges = new Map<string, LabRange>([['lab_ferritina', range(70, 200)]])
    const out = classifyLabResults(
      [
        result('lab_ferritina', 50, '2026-01-10'),
        result('lab_ferritina', 120, '2026-07-20'),
        result('lab_ferritina', 90, '2026-04-02'),
      ],
      ranges,
    )
    expect(out.items).toHaveLength(1)
    expect(out.items[0]!.value).toBe(120)
    expect(out.items[0]!.measuredAt).toBe('2026-07-20')
  })

  it('lista vazia devolve painel vazio, sem quebrar', () => {
    const out = classifyLabResults([], new Map())
    expect(out.items).toEqual([])
    expect(out.low).toBe(0)
    expect(out.high).toBe(0)
  })

  it('a mesma ferritina classifica diferente conforme o sexo (SC-002)', () => {
    // Faixas reais da fonte: H 70–150, M 70–200. Ferritina 180 é ALTA no
    // homem e NORMAL na mulher — é o caso que prova que o recorte por sexo
    // está vivo de ponta a ponta.
    const homem = new Map<string, LabRange>([['lab_ferritina', range(70, 150)]])
    const mulher = new Map<string, LabRange>([['lab_ferritina', range(70, 200)]])
    expect(classifyLabResults([result('lab_ferritina', 180)], homem).items[0]!.class).toBe('alto')
    expect(classifyLabResults([result('lab_ferritina', 180)], mulher).items[0]!.class).toBe('normal')
  })
})
