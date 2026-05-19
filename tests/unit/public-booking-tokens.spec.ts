/**
 * T098 (Feature 017) — unit test para tokens de cancelamento.
 *
 * Verifica:
 *   - generateCancelToken produz raw distinto + hash hex
 *   - hashToken é determinístico
 *   - safeCompareHash usa timingSafeEqual (não joga)
 */

import { describe, it, expect } from 'vitest'
import {
  generateCancelToken,
  hashToken,
  safeCompareHash,
} from '@/lib/core/public-booking/tokens'

describe('public-booking tokens', () => {
  it('gera token raw + hash distintos a cada call', () => {
    const a = generateCancelToken()
    const b = generateCancelToken()
    expect(a.raw).not.toEqual(b.raw)
    expect(a.hash).not.toEqual(b.hash)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.raw.length).toBeGreaterThanOrEqual(32)
  })

  it('hashToken é determinístico', () => {
    const raw = 'fixed-token-for-hash'
    expect(hashToken(raw)).toEqual(hashToken(raw))
  })

  it('safeCompareHash aceita o par raw+hash gerado', () => {
    const { raw, hash } = generateCancelToken()
    expect(safeCompareHash(raw, hash)).toBe(true)
  })

  it('safeCompareHash rejeita raw incorreto', () => {
    const { hash } = generateCancelToken()
    expect(safeCompareHash('not-the-token', hash)).toBe(false)
  })

  it('safeCompareHash não joga em tamanhos divergentes', () => {
    expect(() => safeCompareHash('x', 'aabb')).not.toThrow()
    expect(safeCompareHash('x', 'aabb')).toBe(false)
  })
})
