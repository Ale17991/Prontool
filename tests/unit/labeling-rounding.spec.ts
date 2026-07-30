import { describe, expect, it } from 'vitest'
import {
  declaredDvPercent,
  declaredValue,
  formatDeclared,
  isInsignificant,
  roundForLabel,
} from '@/lib/core/nutrition/labeling/rounding'
import { labelNutrient } from '@/lib/core/nutrition/labeling/reference'

/**
 * Feature 052 (T009) — Anexos III e IV da IN 75/2020.
 *
 * A asserção central deste arquivo: o zero DECLARATÓRIO do Anexo IV (o produto
 * praticamente não tem o nutriente) é um estado distinto do dado DESCONHECIDO
 * (não sei quanto tem). O primeiro vale 0 no rótulo; o segundo atravessa como
 * `null` e nunca vira zero.
 */

const energia = labelNutrient('energia')!
const sodio = labelNutrient('sodio')!
const saturadas = labelNutrient('gorduras_saturadas')!
const carboidratos = labelNutrient('carboidratos')!

describe('Anexo III — arredondamento por faixa', () => {
  it('valores ≥ 10 saem inteiros', () => {
    expect(roundForLabel(10.4, 'g')).toBe(10)
    expect(roundForLabel(10.5, 'g')).toBe(11)
    expect(roundForLabel(342.7, 'kcal')).toBe(343)
    expect(roundForLabel(2633.33, 'mg')).toBe(2633)
  })

  it('na fronteira dos 10, muda a regra', () => {
    // 9,95 ainda está na faixa "1 a <10" (1 decimal); 10,0 já sai inteiro.
    expect(roundForLabel(9.94, 'g')).toBe(9.9)
    expect(roundForLabel(9.95, 'g')).toBe(10)
    expect(roundForLabel(10.0, 'g')).toBe(10)
  })

  it('valores de 1 a menos de 10 saem com até 1 decimal', () => {
    expect(roundForLabel(1.24, 'g')).toBe(1.2)
    expect(roundForLabel(1.25, 'g')).toBe(1.3)
    expect(roundForLabel(5.04, 'g')).toBe(5)
    expect(roundForLabel(9.06, 'g')).toBe(9.1)
  })

  it('abaixo de 1 em gramas sai com 1 decimal', () => {
    expect(roundForLabel(0.94, 'g')).toBe(0.9)
    expect(roundForLabel(0.95, 'g')).toBe(1)
    expect(roundForLabel(0.04, 'g')).toBe(0)
  })

  it('abaixo de 1 em mg sai com até 2 decimais', () => {
    expect(roundForLabel(0.944, 'mg')).toBe(0.94)
    expect(roundForLabel(0.945, 'mg')).toBe(0.95)
    expect(roundForLabel(0.104, 'mg')).toBe(0.1)
  })

  it('não sofre com o ruído binário do ponto flutuante', () => {
    // 1.005 em binário é 1.00499999…; toFixed devolveria 1.00.
    expect(roundForLabel(1.005, 'g')).toBe(1)
    expect(roundForLabel(1.05, 'g')).toBe(1.1)
    expect(roundForLabel(2.675, 'g')).toBe(2.7)
  })

  it('valor não-finito não quebra a tabela', () => {
    expect(roundForLabel(Number.NaN, 'g')).toBe(0)
    expect(roundForLabel(Number.POSITIVE_INFINITY, 'g')).toBe(0)
  })
})

describe('Anexo IV — quantidade não significativa', () => {
  it('declara zero no limite e abaixo dele', () => {
    expect(isInsignificant(4, energia)).toBe(true) // ≤ 4 kcal
    expect(isInsignificant(3.9, energia)).toBe(true)
    expect(isInsignificant(4.1, energia)).toBe(false)

    expect(isInsignificant(5, sodio)).toBe(true) // ≤ 5 mg
    expect(isInsignificant(5.1, sodio)).toBe(false)

    expect(isInsignificant(0.1, saturadas)).toBe(true) // ≤ 0,1 g
    expect(isInsignificant(0.11, saturadas)).toBe(false)

    expect(isInsignificant(0.5, carboidratos)).toBe(true) // ≤ 0,5 g
    expect(isInsignificant(0.51, carboidratos)).toBe(false)
  })
})

describe('declaredValue — os dois zeros', () => {
  it('valor pequeno conhecido vira ZERO DECLARADO', () => {
    // "o produto praticamente não tem sódio" — declaração correta.
    expect(declaredValue(3, sodio)).toBe(0)
    expect(declaredValue(0.05, saturadas)).toBe(0)
  })

  it('valor DESCONHECIDO atravessa como null e NUNCA vira zero', () => {
    // "não sei quanto tem" — imprimir 0 aqui seria declaração falsa.
    expect(declaredValue(null, sodio)).toBeNull()
    expect(declaredValue(null, saturadas)).toBeNull()
    expect(declaredValue(null, energia)).toBeNull()
  })

  it('os dois estados são distinguíveis pelo tipo, não só pelo valor', () => {
    const zeroDeclarado = declaredValue(2, sodio)
    const desconhecido = declaredValue(null, sodio)
    expect(zeroDeclarado).toBe(0)
    expect(desconhecido).toBeNull()
    expect(zeroDeclarado).not.toBe(desconhecido)
  })

  it('valor significativo passa pelo arredondamento do Anexo III', () => {
    expect(declaredValue(342.7, energia)).toBe(343)
    expect(declaredValue(1.24, carboidratos)).toBe(1.2)
  })
})

describe('declaredDvPercent', () => {
  it('calcula o percentual sobre o VDR da norma', () => {
    // 205 kcal sobre 2000 kcal = 10,25% → 10%
    expect(declaredDvPercent(205, energia)).toBe(10)
    // 600 mg de sódio sobre 2000 mg = 30%
    expect(declaredDvPercent(600, sodio)).toBe(30)
  })

  it('nutriente sem VDR não tem %VD', () => {
    const acucaresTotais = labelNutrient('acucares_totais')!
    expect(acucaresTotais.dv).toBeNull()
    expect(declaredDvPercent(12, acucaresTotais)).toBeNull()
  })

  it('valor desconhecido não gera %VD', () => {
    expect(declaredDvPercent(null, energia)).toBeNull()
  })
})

describe('formatDeclared', () => {
  it('usa vírgula decimal', () => {
    expect(formatDeclared(1.2)).toBe('1,2')
    expect(formatDeclared(343)).toBe('343')
  })

  it('desconhecido vira travessão, não zero', () => {
    expect(formatDeclared(null)).toBe('—')
    expect(formatDeclared(0)).toBe('0')
  })
})
