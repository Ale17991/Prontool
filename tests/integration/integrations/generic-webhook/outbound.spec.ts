/**
 * Polish — generic_webhook outbound + multi-adapter fan-out proof.
 *
 * When a tenant has BOTH ghl and generic_webhook enabled, a single
 * patient.created event hits both adapters in parallel. A failure in one
 * adapter does not block the other. Resolves T035 (multi-adapter fan-out)
 * plus the generic_webhook smoke.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedHealthPlan,
  seedGhlIntegration,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { mswServer } from '@/tests/helpers/msw-server'

const OPS_URL = 'http://127.0.0.1:54397'
const GENERIC_URL = 'http://127.0.0.1:54396/clinni-events'

async function seedGenericWebhookIntegration(
  tenantId: string,
  opts: { events?: string[]; bearerToken?: string } = {},
) {
  const sb = serviceClient()
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set')
  const credentials = { bearer_token: opts.bearerToken ?? 'test-bearer' }
  const { data: credsEnc } = await sb.rpc('enc_text_with_key', {
    plain: JSON.stringify(credentials),
    key,
  })
  const { data: users } = await sb.auth.admin.listUsers()
  const createdBy = users?.users?.[0]?.id
  if (!createdBy) throw new Error('seed needs at least one auth user')
  await sb
    .from('tenant_integrations')
    .insert({
      tenant_id: tenantId,
      provider: 'generic_webhook',
      config: {
        outbound_url: GENERIC_URL,
        events: opts.events ?? ['patient.created', 'appointment.created'],
      },
      credentials_enc: credsEnc as unknown as string,
      webhook_secret_enc: null,
      enabled: true,
      created_by_user_id: createdBy,
    })
    .throwOnError()
}

describe('Polish — generic_webhook + multi-adapter fan-out', () => {
  beforeEach(async () => {
    await resetDatabase()
    process.env.SUPABASE_OPERATIONS_URL = OPS_URL
    process.env.SUPABASE_OPERATIONS_ANON_KEY = 'test-ops-anon-key'
  })

  it('generic_webhook receives patient.created POST with expected body shape', async () => {
    const { tenantId } = await seedTenant('poll-generic-happy')
    const admin = await seedUser(tenantId, 'admin')
    await seedHealthPlan(tenantId)
    await seedGenericWebhookIntegration(tenantId)

    let receivedBody: unknown = null
    let receivedAuth: string | null = null
    mswServer.use(
      http.post(GENERIC_URL, async ({ request }) => {
        receivedAuth = request.headers.get('authorization')
        receivedBody = await request.json()
        return HttpResponse.json({ ok: true }, { status: 200 })
      }),
    )

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/pacientes/route')
    const res = await POST(
      new Request('http://localhost/api/pacientes', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ full_name: 'Webhook Recipient', cpf: '12345678901' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      integrationsDispatched: Array<{ provider: string; ok: boolean; detail: string }>
    }
    expect(body.integrationsDispatched).toContainEqual(
      expect.objectContaining({ provider: 'generic_webhook', ok: true }),
    )
    expect(receivedAuth).toBe('Bearer test-bearer')
    expect(receivedBody).toMatchObject({
      event: 'patient.created',
      tenant_id: tenantId,
      payload: {
        patient: expect.objectContaining({
          full_name: 'Webhook Recipient',
          cpf: '12345678901',
        }),
      },
    })
  })

  it('multi-adapter fan-out: GHL + generic_webhook both called; one failure does not block the other', async () => {
    const { tenantId } = await seedTenant('poll-fanout')
    const admin = await seedUser(tenantId, 'admin')
    await seedHealthPlan(tenantId)
    await seedGhlIntegration(tenantId)
    await seedGenericWebhookIntegration(tenantId, { events: ['patient.created'] })

    let ghlCalled = 0
    let genericCalled = 0
    mswServer.use(
      // GHL v2 (feature 008): o adapter posta direto na API do LeadConnector
      // via withGhlAuth — não mais no proxy OPS_URL/functions/v1/create-contact.
      http.post('https://services.leadconnectorhq.com/contacts/', () => {
        ghlCalled++
        // GHL fails — must NOT prevent generic_webhook from succeeding
        return HttpResponse.json({ error: 'ghl down' }, { status: 502 })
      }),
      http.post(GENERIC_URL, () => {
        genericCalled++
        return HttpResponse.json({ ok: true }, { status: 200 })
      }),
    )

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/pacientes/route')
    const res = await POST(
      new Request('http://localhost/api/pacientes', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ full_name: 'Fan Out', cpf: '22233344455' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      integrationsDispatched: Array<{ provider: string; ok: boolean; detail: string }>
    }
    // Both adapters were invoked. O adapter GHL v2 re-tenta 1x em 5xx
    // (fetchWithRetry) → 2 hits; o que importa é que foi chamado e falhou.
    expect(ghlCalled).toBeGreaterThanOrEqual(1)
    expect(genericCalled).toBe(1)
    // Exactly one failure, one success
    expect(body.integrationsDispatched).toHaveLength(2)
    const ghl = body.integrationsDispatched.find((r) => r.provider === 'ghl')
    const gen = body.integrationsDispatched.find((r) => r.provider === 'generic_webhook')
    expect(ghl?.ok).toBe(false)
    expect(gen?.ok).toBe(true)

    // Alert only for the failing adapter, with detail.provider=ghl
    const sb = serviceClient()
    const alerts = await sb.from('alerts').select('*').eq('tenant_id', tenantId)
    expect(alerts.data ?? []).toHaveLength(1)
    const detail = (alerts.data?.[0]?.detail ?? {}) as Record<string, unknown>
    expect(detail.provider).toBe('ghl')
  })

  it('event subscription filter: adapter configured for appointment.* only → patient.created is noop (no POST, no alert)', async () => {
    const { tenantId } = await seedTenant('poll-filter')
    const admin = await seedUser(tenantId, 'admin')
    await seedHealthPlan(tenantId)
    await seedGenericWebhookIntegration(tenantId, { events: ['appointment.created'] })

    let genericCalled = 0
    mswServer.use(
      http.post(GENERIC_URL, () => {
        genericCalled++
        return HttpResponse.json({ ok: true }, { status: 200 })
      }),
    )

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/pacientes/route')
    const res = await POST(
      new Request('http://localhost/api/pacientes', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ full_name: 'Silent', cpf: randomCpf() }),
      }),
    )
    expect(res.status).toBe(201)
    expect(genericCalled).toBe(0)

    const sb = serviceClient()
    const alerts = await sb.from('alerts').select('*').eq('tenant_id', tenantId)
    expect(alerts.data ?? []).toHaveLength(0)
  })
})

function randomCpf(): string {
  // 11 digits, arbitrary; not a valid checksum but seeds don't care.
  return randomUUID().replace(/\D/g, '').slice(0, 11).padEnd(11, '0')
}
