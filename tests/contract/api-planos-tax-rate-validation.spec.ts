/**
 * T033 (Feature 011) — validação Zod para PATCH tax_rate_bps.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — PATCH /api/planos/{id} tax_rate_bps validation', () => {
  let adminJwt: string
  let planId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('plan-tax-val')
    const admin = await seedUser(t.tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId: t.tenantId,
      role: 'admin',
    })
    planId = await seedHealthPlan(t.tenantId, 'Unimed-VAL')
  })

  async function patch(body: unknown): Promise<Response> {
    const { PATCH } = await import('@/app/api/planos/[id]/route')
    return PATCH(
      new Request(`http://localhost/api/planos/${planId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify(body),
      }),
      { params: { id: planId } },
    )
  }

  it('rejeita tax_rate_bps negativo', async () => {
    expect((await patch({ tax_rate_bps: -1 })).status).toBe(400)
  })
  it('rejeita tax_rate_bps > 10000', async () => {
    expect((await patch({ tax_rate_bps: 10001 })).status).toBe(400)
  })
  it('rejeita tax_rate_bps decimal', async () => {
    expect((await patch({ tax_rate_bps: 99.9 })).status).toBe(400)
  })
  it('rejeita tax_rate_bps como string', async () => {
    expect((await patch({ tax_rate_bps: '650' })).status).toBe(400)
  })
  it('rejeita payload vazio (nenhum campo)', async () => {
    expect((await patch({})).status).toBe(400)
  })
  it('aceita tax_rate_bps=0 (desativar imposto)', async () => {
    expect((await patch({ tax_rate_bps: 0 })).status).toBe(200)
  })
  it('aceita tax_rate_bps=10000 (limite máximo)', async () => {
    expect((await patch({ tax_rate_bps: 10000 })).status).toBe(200)
  })
})
