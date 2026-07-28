/**
 * T039 (Feature 051) — precedência do status de entrega (FR-019).
 *
 * A regra existe porque `appointment_reminders` é imutável depois de terminal:
 * a evolução vive numa tabela de eventos, e "o status atual" é uma decisão de
 * LEITURA. Resolver pelo evento mais recente estaria errado — confirmações
 * chegam fora de ordem, e um `delivered` atrasado rebaixaria um `read`.
 */
import { describe, it, expect } from 'vitest'
import { pickHighest } from '@/lib/core/whatsapp/delivery'
import { DELIVERY_RANK } from '@/lib/core/whatsapp/types'

describe('Feature 051 — pickHighest', () => {
  it('avança na ordem natural', () => {
    expect(pickHighest('sent', 'delivered')).toBe('delivered')
    expect(pickHighest('delivered', 'read')).toBe('read')
  })

  it('NÃO regride: delivered atrasado não rebaixa read (FR-019)', () => {
    expect(pickHighest('read', 'delivered')).toBe('read')
    expect(pickHighest('read', 'sent')).toBe('read')
    expect(pickHighest('delivered', 'sent')).toBe('delivered')
  })

  it('error tem precedência sobre tudo — é o que a clínica precisa ver', () => {
    expect(pickHighest('read', 'error')).toBe('error')
    expect(pickHighest('error', 'read')).toBe('error')
  })

  it('é idempotente com o mesmo status', () => {
    for (const s of ['sent', 'delivered', 'read', 'error'] as const) {
      expect(pickHighest(s, s)).toBe(s)
    }
  })

  it('é comutativo — a ordem de chegada não muda o resultado', () => {
    const todos = ['sent', 'delivered', 'read', 'error'] as const
    for (const a of todos) {
      for (const b of todos) {
        expect(pickHighest(a, b)).toBe(pickHighest(b, a))
      }
    }
  })

  it('o rank reflete a ordem do ciclo de vida', () => {
    expect(DELIVERY_RANK.sent).toBeLessThan(DELIVERY_RANK.delivered)
    expect(DELIVERY_RANK.delivered).toBeLessThan(DELIVERY_RANK.read)
    expect(DELIVERY_RANK.read).toBeLessThan(DELIVERY_RANK.error)
  })
})
