/**
 * US3 — GHL outbound sync end-to-end via event bus.
 *
 *   a) tenant connected + proxy 201 → ghl_contact_id persisted, ok result,
 *      no alert
 *   b) tenant connected + proxy 500 → patient persisted, alert
 *      integration_sync_failed with detail.provider='ghl', ok=false
 *   c) appointment created for patient with ghl_contact_id → note POST hits
 *      the proxy
 *   d) appointment created for patient WITHOUT ghl_contact_id → note NOT
 *      attempted (no alert — adapter returns success noop)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedHealthPlan,
  seedDoctor,
  seedTussCode,
  seedProcedure,
  seedPriceVersion,
  seedGhlIntegration,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { mswServer } from '@/tests/helpers/msw-server'

const OPS_URL = 'http://127.0.0.1:54399'

function setOpsEnv() {
  process.env.SUPABASE_OPERATIONS_URL = OPS_URL
  process.env.SUPABASE_OPERATIONS_ANON_KEY = 'test-ops-anon-key'
}

// Feature 008: este teste exercitava o caminho proxy Homio Operations
// (legacy Feature 002). O adapter v2 fala direto com services.leadconnectorhq.com
// via Bearer OAuth — coberto por `tests/integration/integrations/ghl/sync-bidirectional.spec.ts`.
describe.skip('US3 — GHL outbound sync via event bus (legacy proxy path — replaced by sync-bidirectional)', () => {
  beforeEach(async () => {
    await resetDatabase()
    setOpsEnv()
  })

  it('(a) patient create OK → ghl_contact_id persisted, integrations_dispatched[0].ok=true, no alert', async () => {
    const { tenantId } = await seedTenant('us3-patient-ok')
    const admin = await seedUser(tenantId, 'admin')
    await seedHealthPlan(tenantId, 'Plano Teste')
    await seedGhlIntegration(tenantId)

    let contactCreatePayload: unknown = null
    mswServer.use(
      http.post(`${OPS_URL}/functions/v1/create-contact`, async ({ request }) => {
        contactCreatePayload = await request.json()
        return HttpResponse.json({ id: 'ghl-contact-abc123' }, { status: 201 })
      }),
    )

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/pacientes/route')
    const res = await POST(
      new Request('http://localhost/api/pacientes', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Teste Fulano',
          cpf: '11122233344',
          phone: '11999998888',
          email: 'teste@ex.com',
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      patientId: string
      ghlSynced: boolean
      ghlContactId: string | null
      integrationsDispatched: Array<{ provider: string; ok: boolean; detail: string }>
    }
    expect(body.ghlSynced).toBe(true)
    expect(body.ghlContactId).toBe('ghl-contact-abc123')
    expect(body.integrationsDispatched).toEqual([
      { provider: 'ghl', ok: true, detail: 'contact_created' },
    ])
    expect(contactCreatePayload).not.toBeNull()

    const sb = serviceClient()
    const alerts = await sb.from('alerts').select('*').eq('tenant_id', tenantId)
    expect(alerts.data ?? []).toHaveLength(0)
  })

  it('(b) patient create — proxy 500 → patient persisted, alert integration_sync_failed with provider=ghl', async () => {
    const { tenantId } = await seedTenant('us3-patient-fail')
    const admin = await seedUser(tenantId, 'admin')
    await seedHealthPlan(tenantId)
    await seedGhlIntegration(tenantId)

    mswServer.use(
      http.post(`${OPS_URL}/functions/v1/create-contact`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    )

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/pacientes/route')
    const res = await POST(
      new Request('http://localhost/api/pacientes', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ full_name: 'Falha Sync', cpf: '22233344455' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      patientId: string
      ghlSynced: boolean
      integrationsDispatched: Array<{ provider: string; ok: boolean; detail: string }>
    }
    expect(body.ghlSynced).toBe(false)
    expect(body.integrationsDispatched[0]?.provider).toBe('ghl')
    expect(body.integrationsDispatched[0]?.ok).toBe(false)

    // Patient row exists locally
    const sb = serviceClient()
    const patient = await sb
      .from('patients')
      .select('id, ghl_contact_id')
      .eq('id', body.patientId)
      .single()
    expect(patient.data?.ghl_contact_id).toBeNull()

    // Alert dispatched with provider=ghl
    const alerts = await sb.from('alerts').select('*').eq('tenant_id', tenantId)
    expect(alerts.data ?? []).toHaveLength(1)
    const detail = (alerts.data?.[0]?.detail ?? {}) as Record<string, unknown>
    expect(alerts.data?.[0]?.type).toBe('integration_sync_failed')
    expect(detail.provider).toBe('ghl')
    expect(detail.action).toBe('create_contact')
  })

  it('(c) appointment create for patient with ghl_contact_id → note POST hits proxy', async () => {
    const { tenantId } = await seedTenant('us3-note-ok')
    const admin = await seedUser(tenantId, 'admin')
    const planId = await seedHealthPlan(tenantId)
    const { doctorId } = await seedDoctor(tenantId, { bps: 3000 })
    await seedTussCode('10101012')
    const procedureId = await seedProcedure(tenantId, '10101012')
    await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 15000,
      validFrom: '2020-01-01',
    })
    await seedGhlIntegration(tenantId)

    // Seed patient directly with ghl_contact_id so we don't need to chain through
    // patient.created first.
    const sb = serviceClient()
    const { data: pat } = await sb
      .from('patients')
      .insert({
        tenant_id: tenantId,
        ghl_contact_id: 'ghl-existing-contact',
        full_name_enc: Buffer.from('stub') as unknown as string,
        cpf_enc: Buffer.from('stub') as unknown as string,
      })
      .select('id')
      .single()
    expect(pat?.id).toBeTruthy()

    let noteCalls = 0
    let lastNoteBody: unknown = null
    mswServer.use(
      http.post(`${OPS_URL}/functions/v1/create-contact-note`, async ({ request }) => {
        noteCalls++
        lastNoteBody = await request.json()
        return HttpResponse.json({ ok: true }, { status: 201 })
      }),
    )

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patient_id: pat!.id,
          doctor_id: doctorId,
          procedure_id: procedureId,
          plan_id: planId,
          appointment_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      integrations_dispatched: Array<{ provider: string; ok: boolean; detail: string }>
    }
    expect(noteCalls).toBe(1)
    expect(lastNoteBody).toMatchObject({ contactId: 'ghl-existing-contact' })
    expect(body.integrations_dispatched).toEqual([
      { provider: 'ghl', ok: true, detail: 'note_created' },
    ])
  })

  it('(d) appointment for patient WITHOUT ghl_contact_id → note NOT attempted (adapter noop, no alert)', async () => {
    const { tenantId } = await seedTenant('us3-note-skip')
    const admin = await seedUser(tenantId, 'admin')
    const planId = await seedHealthPlan(tenantId)
    const { doctorId } = await seedDoctor(tenantId, { bps: 3000 })
    await seedTussCode('10101013')
    const procedureId = await seedProcedure(tenantId, '10101013')
    await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 15000,
      validFrom: '2020-01-01',
    })
    await seedGhlIntegration(tenantId)

    const sb = serviceClient()
    const { data: pat } = await sb
      .from('patients')
      .insert({
        tenant_id: tenantId,
        ghl_contact_id: null,
        full_name_enc: Buffer.from('stub') as unknown as string,
        cpf_enc: Buffer.from('stub') as unknown as string,
      })
      .select('id')
      .single()

    let noteCalls = 0
    mswServer.use(
      http.post(`${OPS_URL}/functions/v1/create-contact-note`, () => {
        noteCalls++
        return HttpResponse.json({ ok: true }, { status: 201 })
      }),
    )

    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/atendimentos/manual/route')
    const res = await POST(
      new Request('http://localhost/api/atendimentos/manual', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patient_id: pat!.id,
          doctor_id: doctorId,
          procedure_id: procedureId,
          plan_id: planId,
          appointment_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      }),
    )
    expect(res.status).toBe(201)
    expect(noteCalls).toBe(0)

    // No failure alert — adapter returned success even without contact id
    const alerts = await sb.from('alerts').select('*').eq('tenant_id', tenantId)
    expect(alerts.data ?? []).toHaveLength(0)
  })
})
