/**
 * T054 (Feature 012) — RBAC /api/configuracoes/usuarios/manual (admin only).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

describe('Feature 012 — /api/configuracoes/usuarios/manual RBAC', () => {
  let tenantId: string
  const users: Record<TenantRole, { jwt: string }> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('manual-rbac')
    tenantId = t.tenantId
    const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = { jwt: mintJwt({ userId: u.userId, email: u.email, tenantId, role }) }
    }
  })

  const cases: Array<{ role: TenantRole; expected: number }> = [
    { role: 'admin', expected: 201 },
    { role: 'financeiro', expected: 403 },
    { role: 'recepcionista', expected: 403 },
    { role: 'profissional_saude', expected: 403 },
  ]

  for (const c of cases) {
    it(`${c.role} → ${c.expected}`, async () => {
      const { POST } = await import('@/app/api/configuracoes/usuarios/manual/route')
      const res = await POST(
        new Request('http://localhost/api/configuracoes/usuarios/manual', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${users[c.role].jwt}`,
          },
          body: JSON.stringify({
            full_name: 'Teste RBAC',
            email: `${c.role}-rbac-${Date.now()}@test.local`,
            password: 'senha12345',
            role: 'recepcionista',
          }),
        }),
      )
      expect(res.status).toBe(c.expected)
    })
  }
})
