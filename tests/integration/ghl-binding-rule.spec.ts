/**
 * Feature 010 (US1) — Regra GHL 1:1 entre clínica e sub-account.
 *
 * Cobre:
 *  - Happy path: tenant A conecta a location X.
 *  - FR-001: tenant A já conectado tenta segunda conexão → 409
 *    GHL_TENANT_ALREADY_CONNECTED.
 *  - FR-002: tenant B tenta conectar a location X já vinculada a A → 409
 *    GHL_LOCATION_ALREADY_BOUND.
 *  - FR-005: disconnect libera ambos os lados; reconexão livre.
 *  - FR-008: rejeições geram audit_log com result='conflict' e field
 *    'connect.rejected:...'.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { connectGhlTenant } from '@/lib/core/integrations/ghl/connect-tenant'
import {
  assertGhlBindingFree,
  GHL_LOCATION_ALREADY_BOUND,
  GHL_TENANT_ALREADY_CONNECTED,
} from '@/lib/core/integrations/ghl/binding-check'
import { ConflictError } from '@/lib/observability/errors'
import type { Database } from '@/lib/db/types'

const FAKE_CREDENTIALS = (locationId: string) => ({
  access_token: 'fake-access-' + locationId,
  refresh_token: 'fake-refresh-' + locationId,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  scopes: ['contacts.write', 'locations.readonly'],
  user_type: 'Location' as const,
  location_id: locationId,
  company_id: 'company-test',
  user_id: '00000000-0000-0000-0000-000000000001',
})

describe('Feature 010 (US1) — GHL 1:1 binding rule', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('happy path: tenant A conecta a location X com sucesso', async () => {
    const { tenantId } = await seedTenant('us1-happy')
    const admin = await seedUser(tenantId, 'admin')
    const supabase = serviceClient() as unknown as SupabaseClient<Database>

    await connectGhlTenant({
      supabase,
      source: 'manual_connect',
      actorUserId: admin.userId,
      actorLabel: 'admin',
      tenantId,
      credentials: FAKE_CREDENTIALS('LOC-X'),
      location: { id: 'LOC-X', name: 'Sub X', timezone: null },
    })

    const { data: row } = await supabase
      .from('tenant_integrations')
      .select('tenant_id, enabled, location_id')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    expect(row).toBeTruthy()
    expect(row?.enabled).toBe(true)
    expect(row?.location_id).toBe('LOC-X')
  })

  it('FR-001: mesma clínica não pode reconectar sem desconectar', async () => {
    const { tenantId } = await seedTenant('us1-fr001')
    const admin = await seedUser(tenantId, 'admin')
    const supabase = serviceClient() as unknown as SupabaseClient<Database>

    await connectGhlTenant({
      supabase,
      source: 'manual_connect',
      actorUserId: admin.userId,
      actorLabel: 'admin',
      tenantId,
      credentials: FAKE_CREDENTIALS('LOC-A'),
      location: { id: 'LOC-A', name: 'Sub A', timezone: null },
    })

    // Tenta segunda conexão para outra location (mesmo tenant).
    let caught: unknown
    try {
      await connectGhlTenant({
        supabase,
        source: 'manual_connect',
        actorUserId: admin.userId,
        actorLabel: 'admin',
        tenantId,
        credentials: FAKE_CREDENTIALS('LOC-B'),
        location: { id: 'LOC-B', name: 'Sub B', timezone: null },
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ConflictError)
    expect((caught as ConflictError).code).toBe(GHL_TENANT_ALREADY_CONNECTED)

    // Audit foi gravado.
    const { data: audit } = await supabase
      .from('audit_log')
      .select('field, result')
      .eq('tenant_id', tenantId)
      .eq('result', 'conflict')
    expect(audit?.some((a) => a.field?.includes('ghl_tenant_already_connected'))).toBe(true)
  })

  it('FR-002: outra clínica não pode conectar à mesma sub-account', async () => {
    const { tenantId: tenantA } = await seedTenant('us1-fr002-a')
    const { tenantId: tenantB } = await seedTenant('us1-fr002-b')
    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    const supabase = serviceClient() as unknown as SupabaseClient<Database>

    await connectGhlTenant({
      supabase,
      source: 'manual_connect',
      actorUserId: adminA.userId,
      actorLabel: 'admin',
      tenantId: tenantA,
      credentials: FAKE_CREDENTIALS('LOC-SHARED'),
      location: { id: 'LOC-SHARED', name: 'Shared Sub', timezone: null },
    })

    let caught: unknown
    try {
      await connectGhlTenant({
        supabase,
        source: 'manual_connect',
        actorUserId: adminB.userId,
        actorLabel: 'admin',
        tenantId: tenantB,
        credentials: FAKE_CREDENTIALS('LOC-SHARED'),
        location: { id: 'LOC-SHARED', name: 'Shared Sub', timezone: null },
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ConflictError)
    expect((caught as ConflictError).code).toBe(GHL_LOCATION_ALREADY_BOUND)

    // Audit registrado para tenantB.
    const { data: audit } = await supabase
      .from('audit_log')
      .select('field, result')
      .eq('tenant_id', tenantB)
      .eq('result', 'conflict')
    expect(audit?.some((a) => a.field?.includes('ghl_location_already_bound'))).toBe(true)
  })

  it('FR-005: disconnect libera ambos os lados', async () => {
    const { tenantId: tenantA } = await seedTenant('us1-fr005-a')
    const { tenantId: tenantB } = await seedTenant('us1-fr005-b')
    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    const supabase = serviceClient() as unknown as SupabaseClient<Database>

    await connectGhlTenant({
      supabase,
      source: 'manual_connect',
      actorUserId: adminA.userId,
      actorLabel: 'admin',
      tenantId: tenantA,
      credentials: FAKE_CREDENTIALS('LOC-MOVE'),
      location: { id: 'LOC-MOVE', name: 'Movable Sub', timezone: null },
    })

    // Desconecta (seta enabled=false).
    await supabase
      .from('tenant_integrations')
      .update({ enabled: false, status: 'disconnected' })
      .eq('tenant_id', tenantA)
      .eq('provider', 'ghl')

    // Pre-flight para tenantB com a mesma location não bate mais.
    await expect(
      assertGhlBindingFree(supabase, { tenantId: tenantB, locationId: 'LOC-MOVE' }),
    ).resolves.toBeUndefined()

    // E B consegue conectar.
    await connectGhlTenant({
      supabase,
      source: 'manual_connect',
      actorUserId: adminB.userId,
      actorLabel: 'admin',
      tenantId: tenantB,
      credentials: FAKE_CREDENTIALS('LOC-MOVE'),
      location: { id: 'LOC-MOVE', name: 'Movable Sub', timezone: null },
    })

    const { data: row } = await supabase
      .from('tenant_integrations')
      .select('tenant_id, enabled')
      .eq('tenant_id', tenantB)
      .eq('provider', 'ghl')
      .single()
    expect(row?.enabled).toBe(true)
  })
})
