/**
 * T103 — Optimistic concurrency on price chain.
 *
 * Two sessions load the same head id. First submits and wins. Second
 * submits with the now-stale `expected_head_id` and receives 409
 * `PRICE_VERSION_CONFLICT`. The handler MUST also write a denyAudit row
 * with `result='conflict'` (FR-005b).
 *
 * Red-first: handler import fails until T112.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
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

describe('T103 — optimistic concurrency: stale expected_head_id is rejected', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('second submission with stale token returns 409 and writes a conflict audit row', async () => {
    const { tenantId } = await seedTenant('t103')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const v1 = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 20_000,
      validFrom: '2020-01-01',
    })

    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/precos/versions/route')

    const winnerRes = await POST(make(jwt, procedureId, planId, v1, '2026-01-01', 25_000))
    expect(winnerRes.status).toBe(201)

    // Loser still references v1 even though winner just made v2 the head.
    const loserRes = await POST(make(jwt, procedureId, planId, v1, '2026-02-01', 30_000))
    expect(loserRes.status).toBe(409)
    const loserBody = (await loserRes.json()) as {
      error?: { code?: string; meta?: { current_head_id?: string } }
      code?: string
      current_head_id?: string
    }
    const code = loserBody.error?.code ?? loserBody.code
    expect(code).toBe('PRICE_VERSION_CONFLICT')

    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('result, entity, reason')
      .eq('tenant_id', tenantId)
      .eq('entity', 'price_versions')
      .eq('result', 'conflict')
    expect(audit?.length ?? 0).toBeGreaterThan(0)
  })
})

function make(
  jwt: string,
  procedureId: string,
  planId: string,
  expectedHead: string,
  validFrom: string,
  amount: number,
): Request {
  return new Request('http://localhost/api/precos/versions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      procedure_id: procedureId,
      plan_id: planId,
      amount_cents: amount,
      valid_from: validFrom,
      reason: 'concorrência teste',
      expected_head_id: expectedHead,
    }),
  })
}
