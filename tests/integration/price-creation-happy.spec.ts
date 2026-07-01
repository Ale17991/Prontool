/**
 * T101 — Admin creates first price version then a second with future
 * `valid_from`. Resolving the head as of today returns v1 (still in
 * vigência); resolving as of next month returns v2.
 *
 * Red-first: handler import fails until T112; resolvePrice already exists
 * (T079) so the read-side comparison works once v2 is created.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const TUSS = '10101012'

describe('T101 — admin creates v1 then v2 with future valid_from', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('head as-of today is v1; head as-of next month is v2', async () => {
    const { tenantId } = await seedTenant('t101')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/precos/versions/route')

    const v1Res = await POST(
      makeRequest(jwt, {
        procedure_id: procedureId,
        plan_id: planId,
        amount_cents: 20_000,
        valid_from: '2020-01-01',
        reason: 'preco inicial',
        expected_head_id: null,
      }),
    )
    expect(v1Res.status).toBe(201)
    const v1 = (await v1Res.json()) as { id: string }

    const nextMonth = new Date()
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
    const futureDate = nextMonth.toISOString().slice(0, 10)

    const v2Res = await POST(
      makeRequest(jwt, {
        procedure_id: procedureId,
        plan_id: planId,
        amount_cents: 25_000,
        valid_from: futureDate,
        reason: 'aumento programado',
        expected_head_id: v1.id,
      }),
    )
    expect(v2Res.status).toBe(201)

    const sb = serviceClient()
    const today = new Date().toISOString().slice(0, 10)
    const headToday = await sb
      .from('price_versions')
      .select('id, amount_cents')
      .eq('tenant_id', tenantId)
      .eq('procedure_id', procedureId)
      .eq('plan_id', planId)
      .lte('valid_from', today)
      .order('valid_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    expect(headToday.data?.amount_cents).toBe(20_000)

    const headFuture = await sb
      .from('price_versions')
      .select('id, amount_cents')
      .eq('tenant_id', tenantId)
      .eq('procedure_id', procedureId)
      .eq('plan_id', planId)
      .lte('valid_from', futureDate)
      .order('valid_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    expect(headFuture.data?.amount_cents).toBe(25_000)
  })
})

function makeRequest(jwt: string, body: unknown): Request {
  return new Request('http://localhost/api/precos/versions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  })
}
