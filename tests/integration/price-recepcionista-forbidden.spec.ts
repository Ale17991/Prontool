/**
 * T105 — recepcionista cannot POST a price version. requireRole denies
 * with 403 and writes a denyAudit row.
 *
 * Red-first: handler import fails until T112.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const TUSS = '10101012'

describe('T105 — recepcionista is forbidden from creating price versions', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('returns 403 and audits the denial', async () => {
    const { tenantId } = await seedTenant('t105')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const recep = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({
      userId: recep.userId,
      email: recep.email,
      tenantId,
      role: 'recepcionista',
    })

    // @ts-expect-error — implementation pending (T112)
    const { POST } = await import('@/app/api/precos/versions/route')

    const res = await POST(
      new Request('http://localhost/api/precos/versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          procedure_id: procedureId,
          plan_id: planId,
          amount_cents: 10_000,
          valid_from: '2026-01-01',
          reason: 'tentativa',
          expected_head_id: null,
        }),
      }),
    )
    expect(res.status).toBe(403)

    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('result, entity, actor_id')
      .eq('tenant_id', tenantId)
      .eq('actor_id', recep.userId)
      .eq('result', 'denied')
    expect(audit?.length ?? 0).toBeGreaterThan(0)
  })
})
