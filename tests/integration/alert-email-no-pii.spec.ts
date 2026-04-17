/**
 * T074 — Alert emails must not leak patient PII.
 *
 * Fire a webhook that triggers a `webhook_rejected` alert for a payload that
 * carries a known patient's data. Capture the Resend request (via MSW spy)
 * and assert subject + body contain no occurrences of the patient's CPF,
 * full name, phone, or email. Validates SC-013 / FR-037.
 *
 * Red-first: MSW resend spy + worker impl not in place until T083/T085.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedGhlConfig } from '@/tests/helpers/seed-factories'
import { buildSignedWebhookRequest, buildValidGhlPayload } from '@/tests/helpers/webhook-request'

const PATIENT = {
  cpf: '98765432100',
  full_name: 'Joana PII Sensitive',
  phone: '+5511988887777',
  email: 'joana.sensitive@test.local',
}

describe('T074 — alert emails carry no patient PII', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('resend payload (subject + body) contains none of cpf/name/phone/email', async () => {
    const { tenantId } = await seedTenant('t074')
    await seedGhlConfig(tenantId)

    const payload = buildValidGhlPayload({ event_id: 'evt_pii_leak_check' })
    payload.contact.custom_fields.patient_cpf = PATIENT.cpf
    payload.contact.custom_fields.patient_name = PATIENT.full_name
    payload.contact.custom_fields.patient_phone = PATIENT.phone
    payload.contact.custom_fields.patient_email = PATIENT.email
    delete (payload.contact.custom_fields as Record<string, string>).plano // force DLQ

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

    const { resendSpy } = await import('@/tests/helpers/msw-spies')
    expect(resendSpy.calls.length).toBeGreaterThan(0)

    for (const call of resendSpy.calls) {
      const haystack = `${call.subject ?? ''}\n${call.body ?? ''}`
      expect(haystack).not.toMatch(PATIENT.cpf)
      expect(haystack).not.toMatch(PATIENT.full_name)
      expect(haystack).not.toMatch(PATIENT.phone)
      expect(haystack).not.toMatch(PATIENT.email)
    }
  })
})
