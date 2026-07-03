/**
 * T067a — TUSS code retired between procedure setup and atendimento.
 *
 * Procedure was created while its TUSS was active; later the catalog marks
 * that TUSS as retired (valid_to in the past). A new webhook referencing the
 * procedure must land in DLQ with `failure_reason='TUSS_CODE_RETIRED'`.
 * Validates FR-016 at appointment time, not just procedure-creation time.
 *
 * Red-first: worker import fails until T085.
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

describe('T067a — TUSS retired after procedure was configured', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('routes webhook to DLQ with TUSS_CODE_RETIRED', async () => {
    const { tenantId } = await seedTenant('t067a')
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

    // Retire the TUSS after the procedure has already been configured.
    const sb = serviceClient()
    const { error } = await sb
      .from('tuss_codes')
      .update({ valid_to: '2024-12-31' })
      .eq('code', TUSS)
    expect(error).toBeNull()

    const payload = buildValidGhlPayload({ event_id: 'evt_retired_tuss' })
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

    const { data: raw } = await sb
      .from('dlq_events')
      .select('id, processing_status, failure_reason')
      .eq('id', raw_event_id)
      .single()
    expect(raw?.processing_status).toBe('dlq')
    expect(raw?.failure_reason).toBe('TUSS_CODE_RETIRED')
  })
})
