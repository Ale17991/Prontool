/**
 * T048 (Feature 011) — POST /api/despesas (tenant A) com tax_id de tenant B → 400.
 *
 * Defesa em 3 camadas:
 *   1. core lookup filtra por tenant_id (.eq) — retorna 0 rows → ValidationError
 *   2. trigger enforce_expenses_tax_same_tenant no DB (caso passe na camada 1)
 *   3. RLS impede leitura de tax de outro tenant (efeito colateral)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — POST /api/despesas cross-tenant tax_id', () => {
  let adminAjwt: string
  let taxOfB: string

  beforeAll(async () => {
    await resetDatabase()
    const tenantA = (await seedTenant('exp-tax-iso-a')).tenantId
    const tenantB = (await seedTenant('exp-tax-iso-b')).tenantId
    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    adminAjwt = mintJwt({
      userId: adminA.userId,
      email: adminA.email,
      tenantId: tenantA,
      role: 'admin',
    })

    const sb = serviceClient()
    const { data, error } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: tenantB,
        name: 'ISS-B',
        rate_bps: 500,
        category: 'municipal',
        created_by: adminB.userId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed: ${error.message}`)
    taxOfB = (data as unknown as { id: string }).id
  })

  it('admin do tenant A POSTing despesa com tax_id de B → 400', async () => {
    const { POST } = await import('@/app/api/despesas/route')
    const res = await POST(
      new Request('http://localhost/api/despesas', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminAjwt}`,
        },
        body: JSON.stringify({
          category: 'impostos',
          description: 'cross-tenant attempt',
          amount_cents: 100,
          competence_date: '2026-05-01',
          tax_id: taxOfB,
        }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
