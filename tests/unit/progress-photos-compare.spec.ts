import { describe, expect, it } from 'vitest'
import {
  buildPairs,
  buildSeries,
  describeInterval,
  type ProgressPhoto,
} from '@/lib/core/patients/progress-photos/compare'

function photo(
  id: string,
  takenOn: string,
  angle: ProgressPhoto['angle'] = 'frente',
): ProgressPhoto {
  return { id, angle, takenOn, note: null, signedUrl: `https://signed/${id}` }
}

describe('describeInterval', () => {
  it('escolhe a maior unidade que ainda descreve o intervalo', () => {
    expect(describeInterval('2026-01-01', '2026-01-01')).toBe('mesmo dia')
    expect(describeInterval('2026-01-01', '2026-01-02')).toBe('1 dia')
    expect(describeInterval('2026-01-01', '2026-01-08')).toBe('7 dias')
    expect(describeInterval('2026-01-01', '2026-01-22')).toBe('3 semanas')
    expect(describeInterval('2026-01-01', '2026-07-01')).toBe('6 meses')
    expect(describeInterval('2026-01-01', '2027-01-01')).toBe('1 ano')
  })

  it('soma os meses que sobram do ano', () => {
    expect(describeInterval('2026-01-01', '2027-07-01')).toBe('1 ano e 6 meses')
  })

  it('devolve travessão em data inválida, nunca um número inventado', () => {
    expect(describeInterval('ontem', '2026-01-01')).toBe('—')
  })
})

describe('buildPairs', () => {
  it('não monta comparação com menos de duas fotos', () => {
    expect(buildPairs([])).toEqual([])
    expect(buildPairs([photo('a', '2026-01-01')])).toEqual([])
  })

  it('com duas fotos monta só a primeira × última — a "anterior" seria a mesma', () => {
    const pairs = buildPairs([photo('a', '2026-01-01'), photo('b', '2026-06-01')])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.kind).toBe('resultado')
    expect(pairs[0]?.before.id).toBe('a')
    expect(pairs[0]?.after.id).toBe('b')
    expect(pairs[0]?.interval).toBe('5 meses')
  })

  it('com três ou mais monta os dois pares, e a "anterior" é a penúltima', () => {
    const pairs = buildPairs([
      photo('a', '2026-01-01'),
      photo('b', '2026-03-01'),
      photo('c', '2026-06-01'),
    ])
    expect(pairs.map((p) => p.kind)).toEqual(['resultado', 'recente'])
    expect(pairs[0]?.after.id).toBe('c')
    expect(pairs[1]?.after.id).toBe('b')
  })

  it('ordena por data, não pela ordem de chegada da lista', () => {
    const pairs = buildPairs([
      photo('c', '2026-06-01'),
      photo('a', '2026-01-01'),
      photo('b', '2026-03-01'),
    ])
    expect(pairs[0]?.before.id).toBe('a')
    expect(pairs[0]?.after.id).toBe('c')
  })

  it('desempata datas iguais pelo id, para a ordem não variar entre leituras', () => {
    const first = buildPairs([photo('z', '2026-01-01'), photo('a', '2026-01-01')])
    const again = buildPairs([photo('a', '2026-01-01'), photo('z', '2026-01-01')])
    expect(first[0]?.before.id).toBe(again[0]?.before.id)
    expect(first[0]?.before.id).toBe('a')
  })
})

describe('buildSeries', () => {
  it('nunca compara ângulos diferentes entre si', () => {
    const series = buildSeries([
      photo('f1', '2026-01-01', 'frente'),
      photo('p1', '2026-02-01', 'perfil_direito'),
      photo('f2', '2026-06-01', 'frente'),
    ])
    const frente = series.find((s) => s.angle === 'frente')
    const perfil = series.find((s) => s.angle === 'perfil_direito')

    expect(frente?.pairs).toHaveLength(1)
    expect(frente?.pairs[0]?.before.id).toBe('f1')
    expect(frente?.pairs[0]?.after.id).toBe('f2')
    // Uma foto só: sem par, e sem tomar emprestada a foto do outro ângulo.
    expect(perfil?.pairs).toEqual([])
  })

  it('omite ângulo sem foto nenhuma em vez de devolver série vazia', () => {
    const series = buildSeries([photo('f1', '2026-01-01', 'frente')])
    expect(series.map((s) => s.angle)).toEqual(['frente'])
  })

  it('mantém a ordem do catálogo, não a de chegada', () => {
    const series = buildSeries([
      photo('c1', '2026-01-01', 'costas'),
      photo('f1', '2026-01-01', 'frente'),
    ])
    expect(series.map((s) => s.angle)).toEqual(['frente', 'costas'])
  })
})
