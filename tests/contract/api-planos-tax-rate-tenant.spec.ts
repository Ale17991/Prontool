/**
 * T035 (Feature 011) — tenant isolation no PATCH tax_rate_bps.
 *
 * Admin do tenant A tentando alterar plano de tenant B → 404 (RLS filtra).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — PATCH /api/planos/{id} tax_rate_bps tenant isolation', () => {
  let tenantA: string
  let adminAjwt: string
  let planOfB: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('plan-tax-iso-a')).tenantId
    const tenantB = (await seedTenant('plan-tax-iso-b')).tenantId
    const adminA = await seedUser(tenantA, 'admin')
    adminAjwt = mintJwt({
      userId: adminA.userId,
      email: adminA.email,
      tenantId: tenantA,
      role: 'admin',
    })
    planOfB = await seedHealthPlan(tenantB, 'PlanoDeB')
  })

  it('admin tenant A PATCHing plano de B → 404', async () => {
    const { PATCH } = await import('@/app/api/planos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/planos/${planOfB}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminAjwt}`,
        },
        body: JSON.stringify({ tax_rate_bps: 999 }),
      }),
      { params: { id: planOfB } },
    )
    expect(res.status).toBe(404)

    // Estado do plano de B intacto
    const sb = serviceClient()
    const { data } = await sb.from('health_plans').select('tax_rate_bps').eq('id', planOfB).single()
    expect((data as { tax_rate_bps?: number } | null)?.tax_rate_bps).toBe(0)
  })
})
