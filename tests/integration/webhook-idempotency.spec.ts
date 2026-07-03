/**
 * T064 — Webhook idempotency.
 *
 * Same `ghl_event_id` delivered twice → second response has duplicate:true;
 * only one row in `appointments`. Enforced at the UNIQUE(tenant_id, ghl_event_id)
 * constraint on `raw_webhook_events` (T021).
 *
 * Red-first: handler import fails until T084; worker until T085.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
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

const TUSS = '10101012'

describe('T064 — webhook idempotency', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('returns duplicate:true on second delivery and creates only one appointment', async () => {
    const { tenantId } = await seedTenant('t064')
    await seedGhlConfig(tenantId)
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    await seedDoctor(tenantId, { crm: 'CRM-12345' })
    await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 10_000,
      validFrom: '2020-01-01',
    })

    const payload = buildValidGhlPayload({ event_id: 'evt_dedup_001' })
    const rawBody = JSON.stringify(payload)

    const { POST: webhookPost } = await import('@/app/api/webhooks/ghl/route')
    const first = await webhookPost(buildSignedWebhookRequest(rawBody))
    const firstJson = (await first.json()) as { duplicate: boolean; raw_event_id: string }
    expect(firstJson.duplicate).toBe(false)

    // Replay same ghl_event_id with a fresh signature timestamp.
    const second = await webhookPost(buildSignedWebhookRequest(rawBody))
    const secondJson = (await second.json()) as { duplicate: boolean; raw_event_id: string }
    expect(second.status).toBe(200)
    expect(secondJson.duplicate).toBe(true)
    expect(secondJson.raw_event_id).toBe(firstJson.raw_event_id)

    const { POST: workerPost } = await import('@/app/api/workers/process-ghl-event/route')
    await workerPost(
      new Request('http://localhost/api/workers/process-ghl-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawEventId: firstJson.raw_event_id }),
      }),
    )

    const sb = serviceClient()
    const { data: appointments } = await sb
      .from('appointments')
      .select('id')
      .eq('tenant_id', tenantId)
    expect(appointments).toHaveLength(1)
    const { data: rawEvents } = await sb
      .from('raw_webhook_events')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('ghl_event_id', 'evt_dedup_001')
    expect(rawEvents).toHaveLength(1)
  })
})
