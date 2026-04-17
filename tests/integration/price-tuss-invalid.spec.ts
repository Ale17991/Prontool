/**
 * T106 — admin cannot create a procedure whose TUSS isn't in the catalog
 * (or is retired). The TUSS validation trigger (migration 0014) raises;
 * the handler surfaces 400.
 *
 * Red-first: handler import fails until T164.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('T106 — procedure with unknown TUSS is rejected by trigger', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('returns 400 and inserts no procedure row', async () => {
    const { tenantId } = await seedTenant('t106')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    // @ts-expect-error — implementation pending (T164)
    const { POST } = await import('@/app/api/procedimentos/route')
    const res = await POST(
      new Request('http://localhost/api/procedimentos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ tuss_code: '99999999' }),
      }),
    )
    expect(res.status).toBe(400)

    const sb = serviceClient()
    const { data: rows } = await sb
      .from('procedures')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('tuss_code', '99999999')
    expect(rows ?? []).toHaveLength(0)
  })
})
