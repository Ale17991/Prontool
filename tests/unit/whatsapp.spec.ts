import { describe, expect, it } from 'vitest'
import { buildWhatsAppUrl, formatPhoneForWhatsApp } from '@/lib/utils/whatsapp'

describe('formatPhoneForWhatsApp', () => {
  it('returns null for null/undefined/empty', () => {
    expect(formatPhoneForWhatsApp(null)).toBeNull()
    expect(formatPhoneForWhatsApp(undefined)).toBeNull()
    expect(formatPhoneForWhatsApp('')).toBeNull()
    expect(formatPhoneForWhatsApp('   ')).toBeNull()
  })

  it('strips formatting and prefixes 55 (BR default)', () => {
    expect(formatPhoneForWhatsApp('(11) 98765-4321')).toBe('5511987654321')
    expect(formatPhoneForWhatsApp('11 98765-4321')).toBe('5511987654321')
    expect(formatPhoneForWhatsApp('11.98765.4321')).toBe('5511987654321')
    expect(formatPhoneForWhatsApp('11987654321')).toBe('5511987654321')
  })

  it('does not duplicate 55 when number already has + DDI', () => {
    expect(formatPhoneForWhatsApp('+55 (11) 98765-4321')).toBe('5511987654321')
    expect(formatPhoneForWhatsApp('+5511987654321')).toBe('5511987654321')
  })

  it('keeps non-Brazilian DDI when + prefix is present', () => {
    expect(formatPhoneForWhatsApp('+1 (415) 555-1234')).toBe('14155551234')
    expect(formatPhoneForWhatsApp('+44 20 7946 0958')).toBe('442079460958')
  })

  it('returns null for non-digit strings or absurd lengths', () => {
    expect(formatPhoneForWhatsApp('abc')).toBeNull()
    expect(formatPhoneForWhatsApp('abc def')).toBeNull()
    // Too short — '551' would only have 3 digits after prefix
    expect(formatPhoneForWhatsApp('1')).toBeNull()
    // Too long
    expect(formatPhoneForWhatsApp('1234567890123456')).toBeNull()
  })
})

describe('buildWhatsAppUrl', () => {
  it('returns wa.me URL for valid input', () => {
    expect(buildWhatsAppUrl('(11) 98765-4321')).toBe('https://wa.me/5511987654321')
    expect(buildWhatsAppUrl('+1 415-555-1234')).toBe('https://wa.me/14155551234')
  })

  it('returns null for invalid input', () => {
    expect(buildWhatsAppUrl(null)).toBeNull()
    expect(buildWhatsAppUrl('')).toBeNull()
    expect(buildWhatsAppUrl('abc')).toBeNull()
  })
})
