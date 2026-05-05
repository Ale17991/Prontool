/**
 * US2 — GHL connect/reconfigure/disconnect via admin config routes.
 * Verifies: row lifecycle in tenant_integrations, audit trail, role guard,
 * redaction of credentials in GET response.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const VALID_CONFIG = {
  location_id: 'abc123XYZ789abc12345',
  trigger_stage_name: 'Pagamento confirmado',
  field_map_plano: 'plano_saude',
  field_map_procedimento_tuss: 'procedimento_tuss',
  field_map_profissional: 'profissional',
  field_map_valor: 'valor_atendimento',
}

const VALID_CREDENTIALS = {
  operations_pat: 'pit-local-dev-token-xxx',
  inbound_webhook_secret: 'a'.repeat(48),
}

// Feature 008: legacy POST/DELETE/[provider] route test — substituído pelo
// caminho OAuth (oauth-flow.spec.ts) e pelo DELETE em /api/configuracoes/integracoes/ghl.
describe.skip('US2 — /api/configuracoes/integracoes/[provider] (GHL) — legacy proxy path', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('GET lista providers com connected=false para tenant standalone', async () => {
    const { tenantId } = await seedTenant('us2-list')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { GET } = await import('@/app/api/configuracoes/integracoes/route')
    const res = await GET(
      new Request('http://localhost/api/configuracoes/integracoes', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      integrations: Array<{ provider: string; connected: boolean }>
    }
    expect(body.integrations.length).toBeGreaterThanOrEqual(1)
    expect(body.integrations.find((i) => i.provider === 'ghl')?.connected).toBe(false)
  })

  it('POST conecta GHL → row criado + audit integration.connect + badge conecta', async () => {
    const { tenantId } = await seedTenant('us2-connect')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { POST } = await import('@/app/api/configuracoes/integracoes/[provider]/route')
    const res = await POST(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          config: VALID_CONFIG,
          credentials: VALID_CREDENTIALS,
          reason: 'Teste de conexão',
        }),
      }),
      { params: { provider: 'ghl' } },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { action: string; connected: boolean }
    expect(body.action).toBe('connected')
    expect(body.connected).toBe(true)

    const sb = serviceClient()
    const row = await sb
      .from('tenant_integrations')
      .select('tenant_id, provider, config, enabled')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    expect(row.data?.enabled).toBe(true)
    expect(row.data?.config).toMatchObject({ location_id: VALID_CONFIG.location_id })

    const audit = await sb
      .from('audit_log')
      .select('field, reason, actor_id')
      .eq('tenant_id', tenantId)
      .eq('entity', 'tenant_integrations')
    expect(audit.data ?? []).toHaveLength(1)
    expect(audit.data?.[0]?.field).toBe('integration.connect:ghl')
    expect(audit.data?.[0]?.reason).toBe('Teste de conexão')
  })

  it('POST em linha existente → action=reconfigured + audit integration.reconfigure', async () => {
    const { tenantId } = await seedTenant('us2-reconfig')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/configuracoes/integracoes/[provider]/route')

    // First connect
    await POST(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          config: VALID_CONFIG,
          credentials: VALID_CREDENTIALS,
          reason: 'Primeira conexão',
        }),
      }),
      { params: { provider: 'ghl' } },
    )

    // Reconfigure
    const res = await POST(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          config: { ...VALID_CONFIG, trigger_stage_name: 'Novo stage' },
          credentials: VALID_CREDENTIALS,
          reason: 'Rotação de secret',
        }),
      }),
      { params: { provider: 'ghl' } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { action: string }
    expect(body.action).toBe('reconfigured')

    const sb = serviceClient()
    const audit = await sb
      .from('audit_log')
      .select('field')
      .eq('tenant_id', tenantId)
      .eq('entity', 'tenant_integrations')
      .order('timestamp_utc', { ascending: true })
    expect(audit.data?.map((r) => r.field)).toEqual([
      'integration.connect:ghl',
      'integration.reconfigure:ghl',
    ])
  })

  it('DELETE desconecta + audit integration.disconnect', async () => {
    const { tenantId } = await seedTenant('us2-disconnect')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/configuracoes/integracoes/[provider]/route')
    const { DELETE } = await import('@/app/api/configuracoes/integracoes/[provider]/route')

    await POST(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          config: VALID_CONFIG,
          credentials: VALID_CREDENTIALS,
          reason: 'Conectando',
        }),
      }),
      { params: { provider: 'ghl' } },
    )

    const res = await DELETE(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Encerrando contrato' }),
      }),
      { params: { provider: 'ghl' } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { action: string; connected: boolean }
    expect(body.action).toBe('disconnected')
    expect(body.connected).toBe(false)

    const sb = serviceClient()
    const row = await sb
      .from('tenant_integrations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .maybeSingle()
    expect(row.data).toBeNull()
  })

  it('GET retorna credenciais redacted, nunca em claro', async () => {
    const { tenantId } = await seedTenant('us2-redact')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/configuracoes/integracoes/[provider]/route')
    const { GET } = await import('@/app/api/configuracoes/integracoes/[provider]/route')

    await POST(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          config: VALID_CONFIG,
          credentials: VALID_CREDENTIALS,
          reason: 'Conectando',
        }),
      }),
      { params: { provider: 'ghl' } },
    )

    const res = await GET(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { provider: 'ghl' } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      connected: boolean
      credentials_redacted: Record<string, string>
    }
    expect(body.connected).toBe(true)
    const responseJson = JSON.stringify(body)
    expect(responseJson).not.toContain(VALID_CREDENTIALS.operations_pat)
    expect(responseJson).not.toContain(VALID_CREDENTIALS.inbound_webhook_secret)
    expect(body.credentials_redacted.operations_pat).toBe('***')
  })

  it('Non-admin (recepcionista) recebe 403 em todos os verbos', async () => {
    const { tenantId } = await seedTenant('us2-rbac')
    const rec = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({
      userId: rec.userId,
      email: rec.email,
      tenantId,
      role: 'recepcionista',
    })
    const { GET: getDetail, POST, DELETE } = await import(
      '@/app/api/configuracoes/integracoes/[provider]/route'
    )
    const { GET: getList } = await import('@/app/api/configuracoes/integracoes/route')

    const listRes = await getList(
      new Request('http://localhost/api/configuracoes/integracoes', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(listRes.status).toBe(403)

    const getRes = await getDetail(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { provider: 'ghl' } },
    )
    expect(getRes.status).toBe(403)

    const postRes = await POST(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ config: VALID_CONFIG, credentials: VALID_CREDENTIALS, reason: 'x' }),
      }),
      { params: { provider: 'ghl' } },
    )
    expect(postRes.status).toBe(403)

    const delRes = await DELETE(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'x' }),
      }),
      { params: { provider: 'ghl' } },
    )
    expect(delRes.status).toBe(403)
  })

  it('Provider desconhecido → 404', async () => {
    const { tenantId } = await seedTenant('us2-unknown')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { GET } = await import('@/app/api/configuracoes/integracoes/[provider]/route')
    const res = await GET(
      new Request('http://localhost/api/configuracoes/integracoes/bogus', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: { provider: 'bogus' } },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PROVIDER_NOT_FOUND')
  })
})
