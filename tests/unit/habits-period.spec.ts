/**
 * Checklist de hábitos — motor de períodos e estatística.
 *
 * O período corrente é CALCULADO, nunca materializado, então errar a conta aqui
 * faria a grade do paciente mostrar a semana errada — o tipo de bug que só
 * aparece na virada, quando ninguém está olhando.
 */
import { describe, expect, it } from 'vitest'
import {
  addDays,
  currentPeriod,
  daysBetween,
  isWithin,
  itemStats,
  periodAt,
  periodIndexFor,
  toDayNumber,
} from '@/lib/core/habits/period'

describe('aritmética de dia civil', () => {
  it('conta dias sem depender de fuso', () => {
    expect(toDayNumber('2026-01-02') - toDayNumber('2026-01-01')).toBe(1)
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('atravessa ano bissexto', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('daysBetween inclui as duas pontas', () => {
    expect(daysBetween('2026-01-01', '2026-01-03')).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ])
  })
})

describe('períodos de comprimento fixo', () => {
  it('semanal tem 7 dias e emenda sem buraco nem sobreposição', () => {
    const p0 = periodAt('2026-08-03', 'semanal', 0)
    const p1 = periodAt('2026-08-03', 'semanal', 1)
    expect(p0.days).toHaveLength(7)
    expect(p0.startDate).toBe('2026-08-03')
    expect(p0.endDate).toBe('2026-08-09')
    expect(p1.startDate).toBe('2026-08-10')
    expect(addDays(p0.endDate, 1)).toBe(p1.startDate)
  })

  it('quinzenal tem 14 dias', () => {
    expect(periodAt('2026-08-03', 'quinzenal', 0).days).toHaveLength(14)
  })

  it('o índice vira exatamente no primeiro dia do período seguinte', () => {
    expect(periodIndexFor('2026-08-03', 'semanal', '2026-08-09')).toBe(0)
    expect(periodIndexFor('2026-08-03', 'semanal', '2026-08-10')).toBe(1)
  })

  it('antes do início mostra o primeiro período, não índice negativo', () => {
    expect(periodIndexFor('2026-08-10', 'semanal', '2026-08-01')).toBe(0)
    expect(currentPeriod('2026-08-10', 'semanal', '2026-08-01').startDate).toBe('2026-08-10')
  })
})

describe('período mensal segue o calendário, não 30 dias', () => {
  it('cada período começa no mesmo dia do mês', () => {
    const p0 = periodAt('2026-01-15', 'mensal', 0)
    const p1 = periodAt('2026-01-15', 'mensal', 1)
    expect(p0.startDate).toBe('2026-01-15')
    expect(p0.endDate).toBe('2026-02-14')
    expect(p1.startDate).toBe('2026-02-15')
  })

  it('quem começa dia 31 cai no último dia dos meses curtos', () => {
    // Somar 30 dias iria escorregando o mês todo.
    expect(periodAt('2026-01-31', 'mensal', 1).startDate).toBe('2026-02-28')
    expect(periodAt('2026-01-31', 'mensal', 2).startDate).toBe('2026-03-31')
  })

  it('fevereiro tem 28 dias no período, não 30', () => {
    expect(periodAt('2026-02-01', 'mensal', 0).days).toHaveLength(28)
    expect(periodAt('2026-01-01', 'mensal', 0).days).toHaveLength(31)
  })

  it('o índice vira no dia certo do mês', () => {
    expect(periodIndexFor('2026-01-15', 'mensal', '2026-02-14')).toBe(0)
    expect(periodIndexFor('2026-01-15', 'mensal', '2026-02-15')).toBe(1)
    expect(periodIndexFor('2026-01-15', 'mensal', '2026-03-20')).toBe(2)
  })
})

describe('limite do período', () => {
  it('aceita retroativo dentro do período e recusa fora', () => {
    const p = periodAt('2026-08-03', 'semanal', 0)
    expect(isWithin(p, '2026-08-03')).toBe(true)
    expect(isWithin(p, '2026-08-09')).toBe(true)
    expect(isWithin(p, '2026-08-02')).toBe(false)
    expect(isWithin(p, '2026-08-10')).toBe(false)
  })
})

const ITEMS = [
  { id: 'agua', label: 'Bateu a meta de água?' },
  { id: 'treino', label: 'Treinou hoje?' },
]

describe('estatística por hábito', () => {
  const days = daysBetween('2026-08-03', '2026-08-09')

  it('conta dias marcados e dias já decorridos — o futuro não é falha', () => {
    const s = itemStats({
      items: ITEMS,
      marks: [
        { itemId: 'agua', markDate: '2026-08-03' },
        { itemId: 'agua', markDate: '2026-08-04' },
      ],
      days,
      today: '2026-08-05',
    })
    const agua = s.find((x) => x.itemId === 'agua')!
    expect(agua.markedDays).toBe(2)
    // Só 3 dias passaram; os outros 4 ainda vão acontecer.
    expect(agua.elapsedDays).toBe(3)
  })

  it('não devolve percentual de aderência — o branco é ambíguo', () => {
    const s = itemStats({ items: ITEMS, marks: [], days, today: '2026-08-09' })
    expect(Object.keys(s[0]!)).not.toContain('adherencePct')
  })

  it('a maior sequência ignora buracos', () => {
    const s = itemStats({
      items: ITEMS,
      marks: ['2026-08-03', '2026-08-04', '2026-08-06', '2026-08-07', '2026-08-08'].map((d) => ({
        itemId: 'treino',
        markDate: d,
      })),
      days,
      today: '2026-08-09',
    })
    expect(s.find((x) => x.itemId === 'treino')!.longestStreak).toBe(3)
  })

  it('a sequência atual não zera só porque hoje ainda não foi marcado', () => {
    // O dia não acabou — punir a pessoa às 8h da manhã seria absurdo.
    const s = itemStats({
      items: ITEMS,
      marks: ['2026-08-03', '2026-08-04', '2026-08-05'].map((d) => ({
        itemId: 'agua',
        markDate: d,
      })),
      days,
      today: '2026-08-06',
    })
    expect(s.find((x) => x.itemId === 'agua')!.currentStreak).toBe(3)
  })

  it('a sequência atual zera quando ontem também ficou em branco', () => {
    const s = itemStats({
      items: ITEMS,
      marks: [{ itemId: 'agua', markDate: '2026-08-03' }],
      days,
      today: '2026-08-06',
    })
    expect(s.find((x) => x.itemId === 'agua')!.currentStreak).toBe(0)
  })

  it('item sem marcação nenhuma aparece zerado, não sumido', () => {
    const s = itemStats({ items: ITEMS, marks: [], days, today: '2026-08-09' })
    expect(s).toHaveLength(2)
    expect(s.every((x) => x.markedDays === 0 && x.longestStreak === 0)).toBe(true)
  })
})
