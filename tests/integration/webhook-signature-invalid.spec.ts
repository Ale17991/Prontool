/**
 * T068 — Webhook with invalid HMAC signature.
 *
 * Endpoint returns 401 synchronously and records an alert with
 * `type='signature_failure'` (so operators can spot attacks / mis-configured
 * tenants). No `raw_webhook_events` row is persisted.
 *
 * Red-first: handler import fails until T084.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedGhlConfig } from '@/tests/helpers/seed-factories'
import { buildSignedWebhookRequest, buildValidGhlPayload } from '@/tests/helpers/webhook-request'

describe('T068 — webhook with bad signature', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('returns 401 and creates signature_failure alert without persisting raw event', async () => {
    const { tenantId } = await seedTenant('t068')
    await seedGhlConfig(tenantId)

    const payload = buildValidGhlPayload({ event_id: 'evt_bad_sig' })
    const req = buildSignedWebhookRequest(payload, { signature: 'deadbeef'.repeat(8) })

    const { POST: webhookPost } = await import('@/app/api/webhooks/ghl/route')
    const res = await webhookPost(req)
    expect(res.status).toBe(401)

    const sb = serviceClient()
    const { data: raw } = await sb
      .from('raw_webhook_events')
      .select('id')
      .eq('ghl_event_id', 'evt_bad_sig')
    expect(raw ?? []).toHaveLength(0)

    const { data: alerts } = await sb.from('alerts').select('type').eq('tenant_id', tenantId)
    expect(alerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'signature_failure' })]),
    )
  })
})
