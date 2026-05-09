import { describe, expect, it } from 'vitest'
import { formatCnpj, isValidCnpj, stripCnpj } from '@/lib/core/clinic-profile/validate-cnpj'

describe('isValidCnpj', () => {
  it('accepts well-known valid CNPJs (with and without mask)', () => {
    // Petrobras
    expect(isValidCnpj('33.000.167/0001-01')).toBe(true)
    expect(isValidCnpj('33000167000101')).toBe(true)
    // Banco do Brasil matriz
    expect(isValidCnpj('00.000.000/0001-91')).toBe(true)
    // Generic valid example
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
  })

  it('rejects CNPJs with wrong check digits', () => {
    expect(isValidCnpj('33.000.167/0001-02')).toBe(false)
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false)
  })

  it('rejects CNPJs with wrong length', () => {
    expect(isValidCnpj('')).toBe(false)
    expect(isValidCnpj('123')).toBe(false)
    expect(isValidCnpj('33000167000101333')).toBe(false)
  })

  it('rejects CNPJs with all repeated digits', () => {
    expect(isValidCnpj('11111111111111')).toBe(false)
    expect(isValidCnpj('00000000000000')).toBe(false)
    expect(isValidCnpj('99999999999999')).toBe(false)
  })

  it('rejects non-digit garbage', () => {
    expect(isValidCnpj('abc.def.ghi/jklm-no')).toBe(false)
  })
})

describe('formatCnpj', () => {
  it('applies the 00.000.000/0000-00 mask to 14 digits', () => {
    expect(formatCnpj('33000167000101')).toBe('33.000.167/0001-01')
    expect(formatCnpj('00000000000191')).toBe('00.000.000/0001-91')
  })

  it('partially formats shorter input as the user types', () => {
    expect(formatCnpj('')).toBe('')
    expect(formatCnpj('33')).toBe('33')
    expect(formatCnpj('33000')).toBe('33.000')
    expect(formatCnpj('33000167')).toBe('33.000.167')
    expect(formatCnpj('330001670001')).toBe('33.000.167/0001')
  })

  it('strips existing mask before reformatting', () => {
    expect(formatCnpj('33.000.167/0001-01')).toBe('33.000.167/0001-01')
  })
})

describe('stripCnpj', () => {
  it('keeps only digits', () => {
    expect(stripCnpj('33.000.167/0001-01')).toBe('33000167000101')
    expect(stripCnpj('  33 000 167 0001 01  ')).toBe('33000167000101')
    expect(stripCnpj('')).toBe('')
  })
})
