/**
 * T069 (Feature 017) — unit test para hashIpForTenant.
 *
 * Verifica:
 *   - mesmo IP+slug => mesmo hash
 *   - mesmo IP, slugs diferentes => hashes diferentes (defesa em profundidade)
 *   - output é hex SHA-256 (64 chars)
 *   - IP em texto claro NUNCA aparece no output
 */

import { describe, it, expect } from 'vitest'
import { hashIpForTenant } from '@/lib/core/public-booking/ip-hash'

describe('hashIpForTenant (LGPD)', () => {
  it('é determinístico para mesmo (ip, slug)', () => {
    const a = hashIpForTenant('203.0.113.42', 'clinica-x')
    const b = hashIpForTenant('203.0.113.42', 'clinica-x')
    expect(a).toEqual(b)
  })

  it('produz hashes diferentes para slugs diferentes', () => {
    const a = hashIpForTenant('203.0.113.42', 'clinica-x')
    const b = hashIpForTenant('203.0.113.42', 'clinica-y')
    expect(a).not.toEqual(b)
  })

  it('output é SHA-256 hex (64 chars)', () => {
    const h = hashIpForTenant('192.168.0.1', 'foo')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('NUNCA contém IP em texto claro', () => {
    const ip = '203.0.113.42'
    const h = hashIpForTenant(ip, 'foo')
    expect(h).not.toContain(ip)
    expect(h).not.toContain('203')
  })
})
