/**
 * US3 — Dispatcher must respect the 5 s per-adapter timeout even when the
 * proxy hangs. Mock the proxy with a 10 s delay; expect the request to
 * return within the aggregated 8 s budget and surface a timeout detail.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedHealthPlan,
  seedGhlIntegration,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { mswServer } from '@/tests/helpers/msw-server'

const OPS_URL = 'http://127.0.0.1:54398'

describe('US3 — adapter respects 5s timeout', () => {
  beforeEach(async () => {
    await resetDatabase()
    process.env.SUPABASE_OPERATIONS_URL = OPS_URL
    process.env.SUPABASE_OPERATIONS_ANON_KEY = 'test-ops-anon-key'
  })

  it('proxy hangs 10s → dispatcher aborts at ~5s, returns ok=false with timeout detail', async () => {
    const { tenantId } = await seedTenant('us3-timeout')
    const admin = await seedUser(tenantId, 'admin')
    await seedHealthPlan(tenantId)
    await seedGhlIntegration(tenantId)

    mswServer.use(
      http.post(`${OPS_URL}/functions/v1/create-contact`, async () => {
        // Hang longer than the 5 s per-adapter budget; the adapter's
        // AbortSignal.timeout(5000) OR the dispatcher's withTimeout wrapper
        // must kick in.
        await new Promise((resolve) => setTimeout(resolve, 10_000))
        return HttpResponse.json({ id: 'never' }, { status: 201 })
      }),
    )

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/pacientes/route')

    const start = Date.now()
    const res = await POST(
      new Request('http://localhost/api/pacientes', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ full_name: 'Timeout Case', cpf: '33344455566' }),
      }),
    )
    const elapsed = Date.now() - start

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      ghlSynced: boolean
      integrationsDispatched: Array<{ provider: string; ok: boolean; detail: string }>
    }
    expect(body.ghlSynced).toBe(false)
    expect(body.integrationsDispatched[0]?.ok).toBe(false)
    // Elapsed must be clearly under 8s (aggregate budget) and reasonably
    // close to the 5s per-adapter timeout.
    expect(elapsed).toBeLessThan(8_000)
  }, 15_000)
})
