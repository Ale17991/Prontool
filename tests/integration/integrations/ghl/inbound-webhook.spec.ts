/**
 * Polish — inbound GHL webhook refactored via dynamic router.
 *
 * Proves:
 *   - /api/webhooks/ghl thin-forwards to /api/webhooks/[provider] (GHL)
 *   - /api/webhooks/bogus returns PROVIDER_NOT_FOUND
 *   - /api/webhooks/[provider] works directly with provider='ghl'
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedGhlConfig,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
} from '@/tests/helpers/seed-factories'
import { buildSignedWebhookRequest, buildValidGhlPayload } from '@/tests/helpers/webhook-request'

async function fullSeed(slug: string) {
  const { tenantId } = await seedTenant(slug)
  await seedGhlConfig(tenantId)
  await seedTussCode('10101012')
  const procedureId = await seedProcedure(tenantId, '10101012')
  const planId = await seedHealthPlan(tenantId, 'Unimed')
  const { doctorId } = await seedDoctor(tenantId, { crm: 'CRM-12345', bps: 4000 })
  await seedPriceVersion({
    tenantId,
    procedureId,
    planId,
    amountCents: 25_000,
    validFrom: '2020-01-01',
  })
  return { tenantId, procedureId, planId, doctorId }
}

describe('Polish — inbound webhook via dynamic router', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('legacy POST /api/webhooks/ghl still works (thin-forward)', async () => {
    await fullSeed('inbound-legacy')
    const payload = buildValidGhlPayload({ event_id: 'evt_legacy_001' })

    const { POST } = await import('@/app/api/webhooks/ghl/route')
    const res = await POST(buildSignedWebhookRequest(payload))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      received: boolean
      duplicate: boolean
      raw_event_id: string
    }
    expect(body.received).toBe(true)
    expect(body.raw_event_id).toBeTruthy()
  })

  it('new POST /api/webhooks/[provider] with provider=ghl returns 200', async () => {
    await fullSeed('inbound-dynamic-ghl')
    const payload = buildValidGhlPayload({ event_id: 'evt_dynamic_001' })

    const { POST } = await import('@/app/api/webhooks/[provider]/route')
    const res = await POST(buildSignedWebhookRequest(payload), { params: { provider: 'ghl' } })
    expect(res.status).toBe(200)
  })

  it('POST /api/webhooks/[provider] with unknown provider returns 404 PROVIDER_NOT_FOUND', async () => {
    const { POST } = await import('@/app/api/webhooks/[provider]/route')
    const res = await POST(
      new Request('http://localhost/api/webhooks/bogus', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      { params: { provider: 'bogus' } },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PROVIDER_NOT_FOUND')
  })

  it('POST /api/webhooks/[provider] with a provider without inbound support returns 405', async () => {
    // generic_webhook is outbound-only — adapter has no handleInboundWebhook.
    const { POST } = await import('@/app/api/webhooks/[provider]/route')
    const res = await POST(
      new Request('http://localhost/api/webhooks/generic_webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      { params: { provider: 'generic_webhook' } },
    )
    expect(res.status).toBe(405)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INBOUND_NOT_SUPPORTED')
  })
})
