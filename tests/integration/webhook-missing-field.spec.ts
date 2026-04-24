/**
 * T065 — Webhook missing required custom field.
 *
 * Payload arrives without `plano`; worker routes to DLQ; `alerts` row created
 * with `type='webhook_rejected'`; e-mail dispatched via Resend (observed with
 * MSW spy). Validates FR-017, FR-022.
 *
 * Red-first: handler/worker imports fail until T084/T085; MSW Resend handler
 * will be wired at that point too.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedGhlConfig, seedUser } from '@/tests/helpers/seed-factories'
import { buildSignedWebhookRequest, buildValidGhlPayload } from '@/tests/helpers/webhook-request'

describe('T065 — webhook missing required custom field', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it("routes event to DLQ with type='webhook_rejected' and dispatches an alert email", async () => {
    const { tenantId } = await seedTenant('t065')
    await seedGhlConfig(tenantId)
    await seedUser(tenantId, 'admin', 'admin-t065') // so dispatchAlert has someone to email

    const payload = buildValidGhlPayload({ event_id: 'evt_missing_plano' })
    delete (payload.contact.custom_fields as Record<string, string>).plano

    const { POST: webhookPost } = await import('@/app/api/webhooks/ghl/route')
    const res = await webhookPost(buildSignedWebhookRequest(payload))
    expect(res.status).toBe(200)
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
    expect(raw?.failure_reason).toBeTruthy()

    const { data: alerts } = await sb
      .from('alerts')
      .select('type, status')
      .eq('tenant_id', tenantId)
    expect(alerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'webhook_rejected' })]),
    )

    const { resendSpy } = await import('@/tests/helpers/msw-spies')
    expect(resendSpy.calls.length).toBeGreaterThan(0)
  })
})
