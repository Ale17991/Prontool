/**
 * T049 (Feature 011) — CHECK constraint expenses_tax_link_requires_impostos_category.
 *
 * Insert direto via service_role com tax_id != NULL e category != 'impostos'
 * → check_violation. Defesa de última camada (caso a app falhe).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'

describe('Feature 011 — DB CHECK expenses_tax_link_requires_impostos_category', () => {
  let tenantId: string
  let adminUserId: string
  let taxId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('exp-check')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
    const sb = serviceClient()
    const { data, error } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: tenantId,
        name: 'ISS-CHK',
        rate_bps: 500,
        category: 'municipal',
        created_by: adminUserId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed: ${error.message}`)
    taxId = (data as unknown as { id: string }).id
  })

  it('INSERT expenses com tax_id + category=aluguel → check_violation', async () => {
    const sb = serviceClient()
    const { error } = await sb.from('expenses').insert({
      tenant_id: tenantId,
      category: 'aluguel', // proibido com tax_id
      description: 'should fail',
      amount_cents: 100,
      competence_date: '2026-05-01',
      recurring: false,
      created_by: adminUserId,
      tax_id: taxId,
    } as never)

    expect(error).not.toBeNull()
    expect(error?.message ?? '').toMatch(
      /expenses_tax_link_requires_impostos_category|violates check/i,
    )
  })

  it('INSERT expenses com tax_id + category=impostos → sucesso', async () => {
    const sb = serviceClient()
    const { error } = await sb.from('expenses').insert({
      tenant_id: tenantId,
      category: 'impostos',
      description: 'should pass',
      amount_cents: 100,
      competence_date: '2026-05-01',
      recurring: false,
      created_by: adminUserId,
      tax_id: taxId,
    } as never)
    expect(error).toBeNull()
  })

  it('INSERT expenses sem tax_id com category=aluguel → sucesso (CHECK só dispara se tax_id NOT NULL)', async () => {
    const sb = serviceClient()
    const { error } = await sb.from('expenses').insert({
      tenant_id: tenantId,
      category: 'aluguel',
      description: 'no link',
      amount_cents: 100,
      competence_date: '2026-05-01',
      recurring: false,
      created_by: adminUserId,
    } as never)
    expect(error).toBeNull()
  })
})
