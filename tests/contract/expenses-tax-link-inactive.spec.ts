/**
 * T047 (Feature 011) — POST /api/despesas com tax_id de imposto desativado → 400.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — POST /api/despesas com tax_id inativo', () => {
  let adminJwt: string
  let inactiveTaxId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('exp-tax-inactive')
    const admin = await seedUser(t.tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId: t.tenantId,
      role: 'admin',
    })

    const sb = serviceClient()
    const { data, error } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: t.tenantId,
        name: 'ISS-OLD',
        rate_bps: 500,
        category: 'municipal',
        is_active: false, // já cria desativado
        created_by: admin.userId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed: ${error.message}`)
    inactiveTaxId = (data as unknown as { id: string }).id
  })

  it('tax_id de imposto is_active=false → 400', async () => {
    const { POST } = await import('@/app/api/despesas/route')
    const res = await POST(
      new Request('http://localhost/api/despesas', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({
          category: 'impostos',
          description: 'imposto inativo',
          amount_cents: 100,
          competence_date: '2026-05-01',
          tax_id: inactiveTaxId,
        }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
