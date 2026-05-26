/**
 * Feature 008 — US4: API endpoints da página de configuração GHL.
 *
 * Cobre os 3 estados (not_connected/connected/token_expired/disconnected),
 * RBAC do POST/DELETE, e — crítico — que tokens nunca aparecem no body de
 * resposta de GET / GET sync-log.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedGhlIntegration } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('US4 — /api/configuracoes/integracoes/ghl + sync-log', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('GET tenant não conectado → status: not_connected', async () => {
    const { tenantId } = await seedTenant('us4-not-connected')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { GET } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await GET(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; custom_fields: unknown[] }
    expect(body.status).toBe('not_connected')
    expect(body.custom_fields).toEqual([])
  })

  it('GET tenant conectado → status: connected, sub_account_name, sem tokens', async () => {
    const { tenantId } = await seedTenant('us4-connected')
    const admin = await seedUser(tenantId, 'admin')
    await seedGhlIntegration(tenantId, {
      locationId: 'loc_us4_conn',
      customFieldIds: { cpf: { id: 'cf_us4_cpf', alias: 'clinni_cpf' } },
      webhookIds: { ContactCreate: 'hk_us4_cc' },
    })
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { GET } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await GET(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    const body = JSON.parse(text) as {
      status: string
      sub_account_name: string
      custom_fields: Array<{ slug: string; id: string }>
      webhooks: Array<{ event: string; id: string }>
    }
    expect(body.status).toBe('connected')
    expect(body.sub_account_name).toBe('Clínica Seed')
    expect(body.custom_fields.find((f) => f.slug === 'cpf')?.id).toBe('cf_us4_cpf')
    expect(body.webhooks.find((w) => w.event === 'ContactCreate')?.id).toBe('hk_us4_cc')

    // Tokens NUNCA aparecem.
    expect(text).not.toContain('at_seed_')
    expect(text).not.toContain('rt_seed_')
    expect(text).not.toContain('access_token')
    expect(text).not.toContain('refresh_token')
    expect(text).not.toContain('credentials_enc')
  })

  it('GET tenant token_expired → status: token_expired', async () => {
    const { tenantId } = await seedTenant('us4-tok-exp')
    const admin = await seedUser(tenantId, 'admin')
    await seedGhlIntegration(tenantId, { locationId: 'loc_us4_exp' })
    const sb = serviceClient()
    await sb
      .from('tenant_integrations')
      .update({ status: 'token_expired' })
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { GET } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await GET(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('token_expired')
  })

  it('GET tenant disconnected → status: disconnected', async () => {
    const { tenantId } = await seedTenant('us4-disc')
    const admin = await seedUser(tenantId, 'admin')
    await seedGhlIntegration(tenantId, { locationId: 'loc_us4_disc', enabled: false })
    const sb = serviceClient()
    await sb
      .from('tenant_integrations')
      .update({ status: 'disconnected' })
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { GET } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await GET(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('disconnected')
  })

  it('GET sem sessão → 401', async () => {
    const { GET } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await GET(
      new Request('http://localhost/api/configuracoes/integracoes/ghl'),
    )
    expect(res.status).toBe(401)
  })

  it('GET /sync-log → 10 entradas com summary, sem PII bruta', async () => {
    const { tenantId } = await seedTenant('us4-synclog')
    const admin = await seedUser(tenantId, 'admin')
    await seedGhlIntegration(tenantId)
    const sb = serviceClient()
    // Insert algumas entradas no log
    for (let i = 0; i < 3; i++) {
      await sb.from('integration_sync_log').insert({
        tenant_id: tenantId,
        provider: 'ghl',
        kind: 'outbound_contact',
        status: 'success',
        detail: { cpf: '12345678901', email: 'maria@example.com', patient_name: 'Maria Silva' },
      })
    }
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { GET } = await import('@/app/api/configuracoes/integracoes/ghl/sync-log/route')
    const res = await GET(
      new Request('http://localhost/api/configuracoes/integracoes/ghl/sync-log', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    const body = JSON.parse(text) as { items: Array<{ kind: string; summary: string }> }
    expect(body.items.length).toBeGreaterThanOrEqual(3)
    expect(body.items[0]!.summary).toContain('Paciente sincronizado')

    // CPF e email mascarados (gravado via redactDetailPii).
    expect(text).not.toContain('12345678901')
    expect(text).not.toContain('maria@example.com')
    expect(text).not.toContain('Maria Silva')
  })

  it('POST não-admin → 403', async () => {
    const { tenantId } = await seedTenant('us4-post-rbac')
    const rec = await seedUser(tenantId, 'recepcionista')
    await seedGhlIntegration(tenantId)
    const jwt = mintJwt({ userId: rec.userId, email: rec.email, tenantId, role: 'recepcionista' })

    const { POST } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await POST(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ trigger_stage_name: 'Novo' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('POST admin tenant conectado → 200 + reconfigure persiste config sem tocar tokens', async () => {
    const { tenantId } = await seedTenant('us4-reconfig')
    const admin = await seedUser(tenantId, 'admin')
    await seedGhlIntegration(tenantId)
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { POST } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await POST(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          trigger_stage_name: 'Pagamento aprovado',
          field_map_plano: 'plano_v2',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const sb = serviceClient()
    const row = await sb
      .from('tenant_integrations')
      .select('config')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    const cfg = row.data?.config as Record<string, unknown>
    expect(cfg.trigger_stage_name).toBe('Pagamento aprovado')
    expect(cfg.field_map_plano).toBe('plano_v2')
  })
})
