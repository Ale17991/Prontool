/**
 * T160 — Same as T106 but explicitly checks that the deny audit fires.
 * The handler MUST call `denyAudit` with `result='denied'` when the
 * trigger rejects the insert.
 *
 * Red-first: handler import fails until T164.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedTussCode } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('T160 — TUSS-invalid procedure write is denied and audited', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('unknown TUSS → 400 + denyAudit', async () => {
    const { tenantId } = await seedTenant('t160-unknown')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/procedimentos/route')
    const res = await POST(
      new Request('http://localhost/api/procedimentos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ tuss_code: '00000000' }),
      }),
    )
    expect(res.status).toBe(400)

    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('result, entity, reason')
      .eq('tenant_id', tenantId)
      .eq('entity', 'procedures')
      .eq('result', 'denied')
    expect(audit?.length ?? 0).toBeGreaterThan(0)
  })

  it('retired TUSS → 400 + denyAudit', async () => {
    const { tenantId } = await seedTenant('t160-retired')
    await seedTussCode('80808080', { retired: true })
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/procedimentos/route')
    const res = await POST(
      new Request('http://localhost/api/procedimentos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ tuss_code: '80808080' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
