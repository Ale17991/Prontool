/**
 * T104 — UNIQUE (tenant_id, procedure_id, plan_id, valid_from) is the
 * belt-and-suspenders guarantee under the chain head check. Even if two
 * admins somehow bypass the chain check, the database rejects the second
 * insert with 23505. The handler maps it to 409.
 *
 * We simulate the bypass by inserting v1 with the seed helper (skips
 * the chain head check), then submitting v2 via the API with the SAME
 * `valid_from`.
 *
 * Red-first: handler import fails until T112.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedPriceVersion,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const TUSS = '10101012'

describe('T104 — duplicate valid_from collides at the database UNIQUE', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('returns 409 when valid_from already exists for the (procedure, plan)', async () => {
    const { tenantId } = await seedTenant('t104')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const v1 = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 20_000,
      validFrom: '2026-01-01',
    })

    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    // @ts-expect-error — implementation pending (T112)
    const { POST } = await import('@/app/api/precos/versions/route')

    const res = await POST(
      new Request('http://localhost/api/precos/versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          procedure_id: procedureId,
          plan_id: planId,
          amount_cents: 30_000,
          valid_from: '2026-01-01', // collides with v1
          reason: 'tentativa colidir',
          expected_head_id: v1,
        }),
      }),
    )
    expect(res.status).toBe(409)
  })
})
