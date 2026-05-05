/**
 * Feature 008 — US3: bidirectional sync via adapter v2 (OAuth Bearer).
 *
 * Cobre:
 *   - patient.created → POST /contacts/ no MSW com custom_fields preenchidos.
 *   - appointment.created → POST /contacts/{id}/notes com formato esperado.
 *   - withGhlAuth retorna token_expired → ZERO hits ao MSW + sync_log failure
 *     com error_code='TOKEN_EXPIRED'. Operação local concluiu (já commit).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mswServer } from '@/tests/helpers/msw-server'
import { ghlAdapter } from '@/lib/integrations/ghl/adapter'
import type { AdapterContext, DomainEvent } from '@/lib/integrations/types'
import { logger } from '@/lib/observability/logger'
import { connectGhlTenant } from '@/lib/core/integrations/ghl/connect-tenant'

async function seedConnectedWithFields(slug: string, opts: { expiresInSec?: number } = {}) {
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  const sb = serviceClient()
  const expiresIn = opts.expiresInSec ?? 86_400
  await connectGhlTenant({
    supabase: sb,
    source: 'manual_connect',
    actorUserId: admin.userId,
    actorLabel: 'admin',
    tenantId,
    credentials: {
      access_token: `at_seed_${slug}_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
      refresh_token: `rt_seed_${slug}_xxxxxxxxxxxxxxxxxxxxxxxxxxx`,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: ['contacts.readonly', 'contacts.write'],
      user_type: 'Location',
      location_id: `loc_${slug}`,
      company_id: `comp_${slug}`,
      user_id: `usr_${slug}`,
    },
    location: { id: `loc_${slug}`, name: `Clínica ${slug}`, timezone: null },
  })
  // Patch config with custom_field_ids para que o adapter envie.
  await sb
    .from('tenant_integrations')
    .update({
      config: {
        location_id: `loc_${slug}`,
        sub_account_name: `Clínica ${slug}`,
        timezone: null,
        custom_field_ids: {
          cpf: { id: 'cf_cpf', alias: 'prontool_cpf' },
          plano_saude: { id: 'cf_plano', alias: 'prontool_plano_saude' },
          profissional_responsavel: { id: 'cf_prof', alias: 'prontool_profissional' },
          ultimo_atendimento: { id: 'cf_ultimo', alias: 'prontool_ultimo_atendimento' },
          diagnosticos_ativos: { id: 'cf_diag', alias: 'prontool_diagnosticos_ativos' },
          alergias: { id: 'cf_alergias', alias: 'prontool_alergias' },
        },
        webhook_ids: {},
        menu_id: null,
        menu_status: 'not_attempted',
      },
    })
    .eq('tenant_id', tenantId)
    .eq('provider', 'ghl')
  return { tenantId, admin }
}

async function makeCtx(tenantId: string, slug: string): Promise<AdapterContext<any, any>> {
  const sb = serviceClient()
  // Lê config persistida (que tem custom_field_ids preenchidos pelo helper).
  const { data: row } = await sb
    .from('tenant_integrations')
    .select('config')
    .eq('tenant_id', tenantId)
    .eq('provider', 'ghl')
    .single()
  return {
    tenantId,
    provider: 'ghl',
    config: row?.config ?? {},
    credentials: {} as any, // adapter usa withGhlAuth, não ctx.credentials
    supabase: sb,
    logger,
    now: () => new Date(),
  }
}

describe('US3 — sync bidirecional via adapter v2', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('patient.created → POST /contacts/ com custom_fields + ghl_contact_id persistido', async () => {
    const { tenantId } = await seedConnectedWithFields('us3-pat-ok')

    let capturedBody: any = null
    mswServer.use(
      http.post('https://services.leadconnectorhq.com/contacts/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ contact: { id: 'ghl_contact_us3_ok' } }, { status: 201 })
      }),
    )

    const sb = serviceClient()
    // Insert paciente local antes do dispatch (adapter atualiza ghl_contact_id).
    const patientId = '11111111-2222-3333-4444-555555555555'
    await sb.from('patients').insert({
      id: patientId,
      tenant_id: tenantId,
      full_name_enc: 'placeholder' as any,
      cpf_enc: 'placeholder' as any,
    } as any)

    const event: DomainEvent = {
      type: 'patient.created',
      patient: {
        id: patientId,
        tenantId,
        fullName: 'Maria Silva',
        cpf: '11122233344',
        email: 'maria@example.com',
        phone: '+5511999991234',
        birthDate: null,
        planId: null,
        ghlContactId: null,
      },
    }

    await ghlAdapter.handleDomainEvent(await makeCtx(tenantId, ''), event)

    // MSW recebeu o POST com custom_fields e Bearer.
    expect(capturedBody).toBeTruthy()
    expect(capturedBody.locationId).toBe('loc_us3-pat-ok')
    expect(capturedBody.name).toBe('Maria Silva')
    expect(Array.isArray(capturedBody.customFields)).toBe(true)
    expect(capturedBody.customFields.find((f: any) => f.id === 'cf_cpf')).toBeDefined()

    // ghl_contact_id persistido.
    const updated = await sb
      .from('patients')
      .select('ghl_contact_id')
      .eq('id', patientId)
      .single()
    expect(updated.data?.ghl_contact_id).toBe('ghl_contact_us3_ok')

    // Sync log success.
    const log = await sb
      .from('integration_sync_log')
      .select('kind, status')
      .eq('tenant_id', tenantId)
    expect(log.data?.some((r) => r.kind === 'outbound_contact' && r.status === 'success')).toBe(true)
  })

  it('appointment.created → POST /contacts/{id}/notes com formato esperado', async () => {
    const { tenantId } = await seedConnectedWithFields('us3-note-ok')
    let captured: { url: string; body: any } | null = null
    mswServer.use(
      http.post(
        'https://services.leadconnectorhq.com/contacts/:contactId/notes',
        async ({ request }) => {
          captured = { url: request.url, body: await request.json() }
          return HttpResponse.json({ note: { id: 'note_us3_ok' } }, { status: 201 })
        },
      ),
    )

    const event: DomainEvent = {
      type: 'appointment.created',
      appointment: {
        id: 'appt-1',
        tenantId,
        patientId: 'p-1',
        doctorId: 'd-1',
        procedureId: 'pr-1',
        procedureTussCode: '1.01.01.01-1',
        planId: null,
        appointmentAt: new Date('2026-05-04T10:00:00Z').toISOString(),
        frozenAmountCents: 12500,
        source: 'manual',
      },
      patient: {
        id: 'p-1',
        tenantId,
        fullName: 'Carlos Mendes',
        cpf: '99988877766',
        email: null,
        phone: null,
        birthDate: null,
        planId: null,
        ghlContactId: 'ghl_existing_contact',
      },
    }

    await ghlAdapter.handleDomainEvent(await makeCtx(tenantId, ''), event)

    expect(captured).toBeTruthy()
    expect(captured!.url).toContain('/contacts/ghl_existing_contact/notes')
    const body = captured!.body as { body: string }
    expect(body.body).toContain('Atendimento registrado no Prontool')
    expect(body.body).toContain('Carlos Mendes')
    expect(body.body).toContain('1.01.01.01-1')
  })

  it('Token expirado → zero hits ao MSW + sync_log failure', async () => {
    const { tenantId } = await seedConnectedWithFields('us3-tok-exp')
    const sb = serviceClient()
    // Marca tokenexpired diretamente.
    await sb
      .from('tenant_integrations')
      .update({ status: 'token_expired' })
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')

    let mswHits = 0
    mswServer.use(
      http.post('https://services.leadconnectorhq.com/contacts/', () => {
        mswHits += 1
        return HttpResponse.json({ contact: { id: 'should_not_be_called' } }, { status: 201 })
      }),
    )

    const event: DomainEvent = {
      type: 'patient.created',
      patient: {
        id: '00000000-0000-0000-0000-000000000001',
        tenantId,
        fullName: 'Ana Souza',
        cpf: '12312312312',
        email: null,
        phone: null,
        birthDate: null,
        planId: null,
        ghlContactId: null,
      },
    }

    // Não deve lançar — adapter absorve token_expired silenciosamente.
    await ghlAdapter.handleDomainEvent(await makeCtx(tenantId, ''), event)
    expect(mswHits).toBe(0)

    const log = await sb
      .from('integration_sync_log')
      .select('kind, status, error_code')
      .eq('tenant_id', tenantId)
    expect(
      log.data?.some(
        (r) =>
          r.kind === 'outbound_contact' &&
          r.status === 'failure' &&
          r.error_code === 'TOKEN_EXPIRED',
      ),
    ).toBe(true)
  })
})
