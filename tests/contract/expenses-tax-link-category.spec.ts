/**
 * T045 (Feature 011) — POST /api/despesas com tax_id força category='impostos'.
 *
 * Mesmo que o cliente envie category='aluguel', o servidor sobrescreve
 * para 'impostos' (FR-015). Defesa em camadas: server + DB CHECK.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — POST /api/despesas com tax_id normaliza category=impostos', () => {
  let tenantId: string
  let adminJwt: string
  let adminUserId: string
  let taxId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('exp-tax-cat')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const sb = serviceClient()
    const { data, error } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: tenantId,
        name: 'ISS',
        rate_bps: 500,
        category: 'municipal',
        created_by: adminUserId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed tax: ${error.message}`)
    taxId = (data as unknown as { id: string }).id
  })

  it('POST com tax_id + category=aluguel → category=impostos no DB', async () => {
    const { POST } = await import('@/app/api/despesas/route')
    const res = await POST(
      new Request('http://localhost/api/despesas', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({
          category: 'aluguel', // cliente mandou errado de propósito
          description: 'ISS abr/2026',
          amount_cents: 12500,
          competence_date: '2026-05-01',
          tax_id: taxId,
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; category: string; tax_id: string }
    expect(body.category).toBe('impostos')
    expect(body.tax_id).toBe(taxId)

    // Confirma persistência
    const sb = serviceClient()
    const { data } = await sb
      .from('expenses')
      .select('category, tax_id')
      .eq('id', body.id)
      .single()
    expect(data?.category).toBe('impostos')
    expect((data as { tax_id?: string | null } | null)?.tax_id).toBe(taxId)
  })
})
