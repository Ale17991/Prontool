/**
 * T032 (Feature 011) — RBAC para PATCH tax_rate_bps em /api/planos/{id}.
 *
 * Apenas admin pode alterar tax_rate_bps (mesma regra atual de `active`).
 * Financeiro / recepcionista / profissional_saude → 403.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

describe('Feature 011 — PATCH /api/planos/{id} tax_rate_bps RBAC', () => {
  let tenantId: string
  let planId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('plan-tax-rbac')
    tenantId = t.tenantId
    planId = await seedHealthPlan(tenantId, 'Unimed')
  })

  const cases: Array<{ role: TenantRole; expected: number }> = [
    { role: 'admin', expected: 200 },
    { role: 'financeiro', expected: 403 },
    { role: 'recepcionista', expected: 403 },
    { role: 'profissional_saude', expected: 403 },
  ]

  for (const { role, expected } of cases) {
    it(`PATCH tax_rate_bps → ${expected} para ${role}`, async () => {
      const u = await seedUser(tenantId, role)
      const jwt = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
      const { PATCH } = await import('@/app/api/planos/[id]/route')
      const res = await PATCH(
        new Request(`http://localhost/api/planos/${planId}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ tax_rate_bps: 650 }),
        }),
        { params: { id: planId } },
      )
      expect(res.status).toBe(expected)
    })
  }
})
