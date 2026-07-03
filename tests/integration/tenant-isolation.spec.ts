/**
 * T058: Constitution Principle III validation.
 * Two tenants A and B; authenticated as A, every attempt to read or
 * reference B's data MUST fail or return empty.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { resetDatabase, rlsClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Principle III — tenant isolation', () => {
  let tenantA: string
  let tenantB: string
  let jwtA: string
  let priceInB: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('tenant-a')).tenantId
    tenantB = (await seedTenant('tenant-b')).tenantId

    await seedTussCode('10101012')
    const procA = await seedProcedure(tenantA, '10101012')
    const planA = await seedHealthPlan(tenantA, 'Plano A')
    await seedDoctor(tenantA)
    await seedPriceVersion({
      tenantId: tenantA,
      procedureId: procA,
      planId: planA,
      amountCents: 10000,
      validFrom: '2020-01-01',
    })

    const procB = await seedProcedure(tenantB, '10101012')
    const planB = await seedHealthPlan(tenantB, 'Plano B')
    priceInB = await seedPriceVersion({
      tenantId: tenantB,
      procedureId: procB,
      planId: planB,
      amountCents: 50000,
      validFrom: '2020-01-01',
    })

    const adminA = await seedUser(tenantA, 'admin', 'a-admin')
    jwtA = mintJwt({
      userId: adminA.userId,
      email: adminA.email,
      tenantId: tenantA,
      role: 'admin',
    })
  })

  it("tenant A cannot SELECT tenant B's price_versions", async () => {
    const sb = rlsClient(jwtA)
    const { data } = await sb.from('price_versions').select('*').eq('id', priceInB)
    expect(data).toEqual([])
  })

  it('tenant A sees no procedures from tenant B', async () => {
    const sb = rlsClient(jwtA)
    const { data } = await sb.from('procedures').select('id, tenant_id')
    expect((data ?? []).every((r) => r.tenant_id === tenantA)).toBe(true)
  })

  it('tenant A cannot INSERT a price referencing tenant B', async () => {
    const sb = rlsClient(jwtA)
    const { error } = await sb.from('price_versions').insert({
      tenant_id: tenantB,
      procedure_id: '00000000-0000-0000-0000-000000000001',
      plan_id: '00000000-0000-0000-0000-000000000002',
      amount_cents: 1,
      valid_from: '2020-01-01',
      created_by: '00000000-0000-0000-0000-000000000003',
      reason: 'cross-tenant attempt',
    })
    expect(error).not.toBeNull()
  })

  it('tenant A sees only its own tenants row', async () => {
    const sb = rlsClient(jwtA)
    const { data } = await sb.from('tenants').select('id')
    expect(data).toHaveLength(1)
    expect(data?.[0]?.id).toBe(tenantA)
  })
})
