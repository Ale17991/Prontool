/**
 * Feature 010 (US2 — T020) — Validação do helper de slug.
 *
 * `slugify` precisa ser estável: mesma entrada → mesmo slug. Cobre
 * normalização de acento, espaços, caracteres especiais, max 60 chars
 * e edge cases (string vazia, só especiais).
 */
import { describe, it, expect } from 'vitest'
import { slugify, isValidSlug } from '@/lib/core/auth/slug'

describe('slugify', () => {
  it('normaliza acentuação NFD', () => {
    expect(slugify('Clínica Sorriso')).toBe('clinica-sorriso')
    expect(slugify('São Paulo')).toBe('sao-paulo')
    expect(slugify('Pão de Açúcar')).toBe('pao-de-acucar')
    expect(slugify('Centro Médico Coração')).toBe('centro-medico-coracao')
  })

  it('lowercase + espaços viram hífen único', () => {
    expect(slugify('CLINICA AB')).toBe('clinica-ab')
    expect(slugify('multi  espaços   aqui')).toBe('multi-espacos-aqui')
  })

  it('caracteres especiais e símbolos viram hífen', () => {
    expect(slugify('A&B / C+D')).toBe('a-b-c-d')
    expect(slugify('100% saúde!!')).toBe('100-saude')
    expect(slugify('clinica#1')).toBe('clinica-1')
  })

  it('hífens nas pontas são removidos', () => {
    expect(slugify('   prefixo   ')).toBe('prefixo')
    expect(slugify('---a---b---')).toBe('a-b')
  })

  it('truncado em 60 chars sem hífen final', () => {
    const longName = 'a'.repeat(80)
    const out = slugify(longName)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('-')).toBe(false)
  })

  it('edge cases', () => {
    expect(slugify('')).toBe('')
    expect(slugify('   ')).toBe('')
    expect(slugify('!!!')).toBe('')
    expect(slugify('---')).toBe('')
    // Não-string ou input inválido → vazio.
    expect(slugify(null as unknown as string)).toBe('')
    expect(slugify(undefined as unknown as string)).toBe('')
  })
})

describe('isValidSlug', () => {
  it('aceita slugs no formato canônico', () => {
    expect(isValidSlug('clinica')).toBe(true)
    expect(isValidSlug('clinica-sorriso')).toBe(true)
    expect(isValidSlug('clinica-sorriso-2')).toBe(true)
    expect(isValidSlug('a1')).toBe(true)
    expect(isValidSlug('1-test')).toBe(true)
  })

  it('rejeita formatos inválidos', () => {
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('-clinica')).toBe(false) // começa com hífen
    expect(isValidSlug('Clinica')).toBe(false)  // maiúscula
    expect(isValidSlug('clínica')).toBe(false)  // acento
    expect(isValidSlug('clinica_sorriso')).toBe(false) // underscore
    expect(isValidSlug('a'.repeat(61))).toBe(false) // > 60 chars
  })
})
