/**
 * T066 — Webhook references TUSS code absent from catalog.
 *
 * Worker routes event to DLQ with `failure_reason='TUSS_CODE_UNKNOWN'`
 * (or equivalent) and creates an alert of type='webhook_rejected'.
 *
 * Red-first: worker import fails until T085.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedGhlConfig } from '@/tests/helpers/seed-factories'
import { buildSignedWebhookRequest, buildValidGhlPayload } from '@/tests/helpers/webhook-request'

describe('T066 — webhook with unknown TUSS code', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('routes to DLQ with TUSS_CODE_UNKNOWN and creates alert', async () => {
    const { tenantId } = await seedTenant('t066')
    await seedGhlConfig(tenantId)

    const payload = buildValidGhlPayload({ event_id: 'evt_unknown_tuss' })
    payload.contact.custom_fields.tuss = '99999999' // not in tuss_codes

    // @ts-expect-error — impl pending T084

    const { POST: webhookPost } = await import('@/app/api/webhooks/ghl/route')
    const res = await webhookPost(buildSignedWebhookRequest(payload))
    const { raw_event_id } = (await res.json()) as { raw_event_id: string }

    // @ts-expect-error — impl pending T085

    const { POST: workerPost } = await import('@/app/api/workers/process-ghl-event/route')
    await workerPost(
      new Request('http://localhost/api/workers/process-ghl-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawEventId: raw_event_id }),
      }),
    )

    const sb = serviceClient()
    const { data: raw } = await sb
      .from('raw_webhook_events')
      .select('processing_status, failure_reason')
      .eq('id', raw_event_id)
      .single()
    expect(raw?.processing_status).toBe('dlq')
    expect(raw?.failure_reason).toMatch(/TUSS/i)

    const { data: alerts } = await sb
      .from('alerts')
      .select('type')
      .eq('tenant_id', tenantId)
    expect(alerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'webhook_rejected' })]),
    )
  })
})
