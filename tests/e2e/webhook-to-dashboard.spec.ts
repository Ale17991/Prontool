/**
 * T075 — End-to-end: signed GHL webhook → appointment row visible on the
 * admin dashboard.
 *
 * Covers the MVP happy path (User Story 1):
 *   1. POST a signed payload to /api/webhooks/ghl as the real GHL would.
 *   2. Drive the worker synchronously (QStash is stubbed in dev, so without
 *      this we'd be racing the queue). Importing `processWebhookEvent`
 *      lets the test finish deterministically without needing QStash creds.
 *   3. Log in as the demo admin and assert the atendimentos table now shows
 *      one more row than before the POST.
 */
import { test, expect } from '@playwright/test'
import {
  buildDemoGhlPayload,
  DEMO_WEBHOOK_SECRET,
  ensureDemoSeed,
  getDemoTenantId,
  loadEnv,
  loginAsAdmin,
  serviceClient,
  signPayload,
} from './fixtures'
import { processWebhookEvent } from '../../src/lib/core/webhooks/process-event'

loadEnv()

test.describe.configure({ mode: 'serial' })

test('webhook posts land as appointments on /atendimentos', async ({ page, request }) => {
  test.setTimeout(120_000)
  await ensureDemoSeed()

  const sb = serviceClient()
  const tenantId = await getDemoTenantId(sb)

  const baseline = await sb
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  const before = baseline.count ?? 0

  const eventId = `evt_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const payload = buildDemoGhlPayload({
    event_id: eventId,
    patient_name: `E2E Teste ${Date.now()}`,
  })
  const rawBody = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = signPayload(DEMO_WEBHOOK_SECRET, timestamp, rawBody)

  const webhookRes = await request.post('/api/webhooks/ghl', {
    headers: {
      'content-type': 'application/json',
      'x-ghl-signature': signature,
      'x-ghl-timestamp': timestamp,
    },
    data: rawBody,
  })
  expect(webhookRes.status(), await webhookRes.text()).toBe(200)
  const body = (await webhookRes.json()) as { raw_event_id: string; duplicate: boolean }
  expect(body.duplicate).toBe(false)

  const result = await processWebhookEvent(sb, { rawEventId: body.raw_event_id })
  expect(result.status, `worker failure_code=${result.failureCode ?? 'none'}`).toBe('done')
  expect(result.appointmentId).toBeTruthy()

  const after = await sb
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  expect(after.count ?? 0).toBe(before + 1)

  await loginAsAdmin(page)
  await page.goto('/operacao/atendimentos', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('h1', { hasText: 'Atendimentos' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator('body')).toContainText(
    new RegExp(`${after.count} atendimento`),
  )
})
