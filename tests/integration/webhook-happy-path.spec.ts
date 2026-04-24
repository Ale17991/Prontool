/**
 * T063 — Webhook happy path.
 *
 * Seed full tenant chain; POST webhook; assert raw_webhook_events row.
 * After worker processes, assert `appointments` row has frozen values that
 * match the seeded price and commission. Validates the end-to-end MVP.
 *
 * Red-first: handler import fails until T084; worker import fails until T085.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
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
const AMOUNT_CENTS = 25_000
const COMMISSION_BPS = 4000

describe('T063 — webhook happy path', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('persists raw event, processes into appointment, freezes price + commission', async () => {
    const { tenantId } = await seedTenant('t063')
    await seedGhlConfig(tenantId)
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const { doctorId } = await seedDoctor(tenantId, { crm: 'CRM-12345', bps: COMMISSION_BPS })
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: AMOUNT_CENTS,
      validFrom: '2020-01-01',
    })

    const payload = buildValidGhlPayload({ event_id: 'evt_happy_001' })

    const { POST: webhookPost } = await import('@/app/api/webhooks/ghl/route')
    const webhookRes = await webhookPost(buildSignedWebhookRequest(payload))
    expect(webhookRes.status).toBe(200)
    const webhookJson = (await webhookRes.json()) as {
      received: boolean
      duplicate: boolean
      raw_event_id: string
    }
    expect(webhookJson.received).toBe(true)
    expect(webhookJson.duplicate).toBe(false)

    const sb = serviceClient()
    const { data: rawRow } = await sb
      .from('raw_webhook_events')
      .select('*')
      .eq('id', webhookJson.raw_event_id)
      .single()
    expect(rawRow).toBeTruthy()
    expect(rawRow!.ghl_event_id).toBe('evt_happy_001')

    const { POST: workerPost } = await import('@/app/api/workers/process-ghl-event/route')
    const workerRes = await workerPost(
      new Request('http://localhost/api/workers/process-ghl-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawEventId: webhookJson.raw_event_id }),
      }),
    )
    expect(workerRes.status).toBe(200)

    const { data: appointment } = await sb
      .from('appointments')
      .select('*')
      .eq('tenant_id', tenantId)
      .single()
    expect(appointment).toBeTruthy()
    expect(appointment!.frozen_amount_cents).toBe(AMOUNT_CENTS)
    expect(appointment!.frozen_commission_bps).toBe(COMMISSION_BPS)
    expect(appointment!.source_price_version_id).toBe(priceVersionId)
    expect(appointment!.doctor_id).toBe(doctorId)
    expect(appointment!.source_raw_event_id).toBe(webhookJson.raw_event_id)
  })
})
