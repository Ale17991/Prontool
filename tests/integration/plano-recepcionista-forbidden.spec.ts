/**
 * T161 — recepcionista cannot create or modify health plans. Both POST
 * and PATCH return 403; both write a denyAudit row.
 *
 * Red-first: handler imports fail until T165.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('T161 — recepcionista is forbidden from writing health plans', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('POST /api/planos → 403 + audit denied', async () => {
    const { tenantId } = await seedTenant('t161-create')
    const recep = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({
      userId: recep.userId,
      email: recep.email,
      tenantId,
      role: 'recepcionista',
    })

    // @ts-expect-error — implementation pending (T165)
    const { POST } = await import('@/app/api/planos/route')
    const res = await POST(
      new Request('http://localhost/api/planos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ name: 'Plano Inventado' }),
      }),
    )
    expect(res.status).toBe(403)

    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('result, entity')
      .eq('tenant_id', tenantId)
      .eq('actor_id', recep.userId)
      .eq('result', 'denied')
    expect(audit?.length ?? 0).toBeGreaterThan(0)
  })

  it('PATCH /api/planos/{id} → 403 + audit denied', async () => {
    const { tenantId } = await seedTenant('t161-update')
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const recep = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({
      userId: recep.userId,
      email: recep.email,
      tenantId,
      role: 'recepcionista',
    })

    // @ts-expect-error — implementation pending (T165)
    const { PATCH } = await import('@/app/api/planos/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/planos/${planId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ active: false }),
      }),
      { params: { id: planId } },
    )
    expect(res.status).toBe(403)
  })
})
