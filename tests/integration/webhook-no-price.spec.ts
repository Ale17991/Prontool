/**
 * T067 — Webhook references (procedure, plan) combination with no
 * `price_versions` row.
 *
 * Worker routes event to DLQ and creates alert whose `detail` includes the
 * (procedure, plan) combination so an admin can fix it quickly.
 *
 * Red-first: worker import fails until T085.
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
} from '@/tests/helpers/seed-factories'
import { buildSignedWebhookRequest, buildValidGhlPayload } from '@/tests/helpers/webhook-request'

const TUSS = '10101012'

describe('T067 — webhook with no price for (procedure, plan)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('routes to DLQ with APPOINTMENT_PRICE_MISSING and alert detail carries the combination', async () => {
    const { tenantId } = await seedTenant('t067')
    await seedGhlConfig(tenantId)
    await seedTussCode(TUSS)
    await seedProcedure(tenantId, TUSS)
    await seedHealthPlan(tenantId, 'Bradesco')
    await seedDoctor(tenantId, { crm: 'CRM-12345' })
    // NOTE: no seedPriceVersion — that's the whole point.

    const payload = buildValidGhlPayload({ event_id: 'evt_no_price' })
    payload.contact.custom_fields.plano = 'Bradesco'

    const { POST: webhookPost } = await import('@/app/api/webhooks/ghl/route')
    const res = await webhookPost(buildSignedWebhookRequest(payload))
    const { raw_event_id } = (await res.json()) as { raw_event_id: string }

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
      .from('dlq_events')
      .select('id, processing_status, failure_reason')
      .eq('id', raw_event_id)
      .single()
    expect(raw?.processing_status).toBe('dlq')
    expect(raw?.failure_reason).toMatch(/PRICE/i)

    const { data: alerts } = await sb
      .from('alerts')
      .select('type, detail')
      .eq('tenant_id', tenantId)
    expect(alerts?.length ?? 0).toBeGreaterThan(0)
    const detailJson = JSON.stringify(alerts![0]?.detail ?? {})
    expect(detailJson).toMatch(/Bradesco/)
    expect(detailJson).toMatch(TUSS)
  })
})
