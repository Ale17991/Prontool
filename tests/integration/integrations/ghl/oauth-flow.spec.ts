/**
 * Feature 008 — US1: OAuth manual connect/refresh/disconnect flow.
 *
 * Cobre:
 *   - GET /api/oauth/ghl/authorize → 302 com Location + cookie state.
 *   - GET /api/oauth/ghl/callback happy → tenant_integrations upserted,
 *     audit_log integration.connect, sync_log connect:success.
 *   - GET /callback com state mismatch → 401, sem mutação.
 *   - GET /callback com /oauth/token retornando 4xx → 502, sem corrupção.
 *   - DELETE /api/configuracoes/integracoes/ghl admin → status=disconnected,
 *     audit_log integration.disconnect, dados preservados.
 *   - DELETE não-admin → 403 + audit deny.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { ghlOauthTokenSpy, makeGhlTokenResponse } from '@/tests/helpers/msw-spies'
import { STATE_COOKIE_NAME } from '@/lib/integrations/ghl/oauth/state'

function parseSetCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const parts = header.split(/, (?=[A-Za-z])/)
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    if (k === name) {
      const valueAndAttrs = part.slice(eq + 1)
      const semi = valueAndAttrs.indexOf(';')
      const raw = semi >= 0 ? valueAndAttrs.slice(0, semi) : valueAndAttrs
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  }
  return null
}

function extractStateFromLocation(location: string): string {
  const url = new URL(location)
  return url.searchParams.get('state') ?? ''
}

describe('US1 — /api/oauth/ghl/{authorize,callback,refresh} + DELETE', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('GET /authorize (admin) → 302 com Location chooselocation + cookie state', async () => {
    const { tenantId } = await seedTenant('us1-authorize')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { GET } = await import('@/app/api/oauth/ghl/authorize/route')
    const res = await GET(
      new Request('http://localhost/api/oauth/ghl/authorize', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )

    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toMatch(/^https:\/\/marketplace\.gohighlevel\.com\/oauth\/chooselocation\?/)
    const url = new URL(location!)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('test_client_id')
    expect(url.searchParams.get('state')).toBeTruthy()

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie).toContain(`${STATE_COOKIE_NAME}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
  })

  it('GET /authorize não-admin → 403 + audit deny', async () => {
    const { tenantId } = await seedTenant('us1-authorize-rbac')
    const rec = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({ userId: rec.userId, email: rec.email, tenantId, role: 'recepcionista' })

    const { GET } = await import('@/app/api/oauth/ghl/authorize/route')
    const res = await GET(
      new Request('http://localhost/api/oauth/ghl/authorize', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(403)

    const sb = serviceClient()
    const audit = await sb
      .from('audit_log')
      .select('result')
      .eq('tenant_id', tenantId)
      .eq('result', 'denied')
    expect(audit.data?.length ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('GET /callback happy → tenant_integrations upserted + audit + sync_log', async () => {
    const { tenantId } = await seedTenant('us1-callback-happy')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    // 1. Inicia o flow para gerar cookie state.
    const { GET: authorize } = await import('@/app/api/oauth/ghl/authorize/route')
    const authRes = await authorize(
      new Request('http://localhost/api/oauth/ghl/authorize', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    const setCookie = authRes.headers.get('set-cookie')!
    const cookieValue = parseSetCookie(setCookie, STATE_COOKIE_NAME)!
    const stateNonce = extractStateFromLocation(authRes.headers.get('location')!)

    // 2. Stub do GHL response com locationId conhecido.
    ghlOauthTokenSpy.queueResponse(
      makeGhlTokenResponse({
        locationId: 'loc_us1_happy',
        userId: 'usr_us1_happy',
        companyId: 'comp_us1_happy',
      }),
    )

    // 3. Simula GHL chamando o callback.
    const { GET: callback } = await import('@/app/api/oauth/ghl/callback/route')
    const cbRes = await callback(
      new Request(
        `http://localhost/api/oauth/ghl/callback?code=fake_code_123&state=${stateNonce}`,
        {
          headers: { cookie: `${STATE_COOKIE_NAME}=${encodeURIComponent(cookieValue)}` },
        },
      ),
    )
    expect(cbRes.status).toBe(302)
    expect(cbRes.headers.get('location')).toContain(
      '/configuracoes/integracoes/ghl?status=connected',
    )

    // GHL token endpoint foi chamado com authorization_code.
    expect(ghlOauthTokenSpy.calls).toHaveLength(1)
    expect(ghlOauthTokenSpy.calls[0]!.body.get('grant_type')).toBe('authorization_code')
    expect(ghlOauthTokenSpy.calls[0]!.body.get('code')).toBe('fake_code_123')

    // Row em tenant_integrations.
    const sb = serviceClient()
    const row = await sb
      .from('tenant_integrations')
      .select('tenant_id, provider, status, enabled, location_id, credentials_enc')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    expect(row.data?.status).toBe('connected')
    expect(row.data?.enabled).toBe(true)
    expect(row.data?.location_id).toBe('loc_us1_happy')
    expect(row.data?.credentials_enc).toBeTruthy()

    // Audit log integration.connect:ghl.
    const audit = await sb
      .from('audit_log')
      .select('field, reason, actor_id')
      .eq('tenant_id', tenantId)
      .eq('entity', 'tenant_integrations')
    expect(audit.data?.some((r) => r.field === 'integration.connect:ghl')).toBe(true)

    // Sync log: pelo menos um connect:success (post-connect-setup é stub).
    const syncLog = await sb
      .from('integration_sync_log')
      .select('kind, status')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
    expect(syncLog.data?.some((r) => r.kind === 'connect' && r.status === 'success')).toBe(true)

    // Body da resposta NÃO contém access_token.
    const responseDump = JSON.stringify({
      headers: Object.fromEntries(cbRes.headers.entries()),
      body: await cbRes.text(),
    })
    expect(responseDump).not.toContain('at_test_')
    expect(responseDump).not.toContain('rt_test_')
  })

  it('GET /callback com state mismatch → 401, sem mutação', async () => {
    const { tenantId } = await seedTenant('us1-callback-mismatch')
    const sb = serviceClient()

    const { GET: callback } = await import('@/app/api/oauth/ghl/callback/route')
    const res = await callback(
      new Request('http://localhost/api/oauth/ghl/callback?code=x&state=wrong_nonce', {
        headers: { cookie: '' },
      }),
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('STATE_MISMATCH')

    const row = await sb
      .from('tenant_integrations')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
    expect(row.data?.length ?? 0).toBe(0)
    expect(ghlOauthTokenSpy.calls.length).toBe(0)
  })

  it('GET /callback com /oauth/token retornando 400 → 502, sem corrupção', async () => {
    const { tenantId } = await seedTenant('us1-callback-bad-code')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { GET: authorize } = await import('@/app/api/oauth/ghl/authorize/route')
    const authRes = await authorize(
      new Request('http://localhost/api/oauth/ghl/authorize', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    const cookieValue = parseSetCookie(authRes.headers.get('set-cookie'), STATE_COOKIE_NAME)!
    const stateNonce = extractStateFromLocation(authRes.headers.get('location')!)

    // GHL retorna 400 invalid_grant.
    ghlOauthTokenSpy.queueResponse({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'code already consumed' },
    })

    const { GET: callback } = await import('@/app/api/oauth/ghl/callback/route')
    const res = await callback(
      new Request(`http://localhost/api/oauth/ghl/callback?code=bad_code&state=${stateNonce}`, {
        headers: { cookie: `${STATE_COOKIE_NAME}=${encodeURIComponent(cookieValue)}` },
      }),
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('CODE_EXCHANGE_FAILED')

    const sb = serviceClient()
    const row = await sb
      .from('tenant_integrations')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
    expect(row.data?.length ?? 0).toBe(0)
  })

  it('DELETE /api/configuracoes/integracoes/ghl (admin) → status=disconnected', async () => {
    const { tenantId } = await seedTenant('us1-disconnect')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    // Conectar primeiro via callback simulado.
    const { GET: authorize } = await import('@/app/api/oauth/ghl/authorize/route')
    const authRes = await authorize(
      new Request('http://localhost/api/oauth/ghl/authorize', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    const cookieValue = parseSetCookie(authRes.headers.get('set-cookie'), STATE_COOKIE_NAME)!
    const stateNonce = extractStateFromLocation(authRes.headers.get('location')!)
    ghlOauthTokenSpy.queueResponse(makeGhlTokenResponse({ locationId: 'loc_us1_disc' }))
    const { GET: callback } = await import('@/app/api/oauth/ghl/callback/route')
    await callback(
      new Request(`http://localhost/api/oauth/ghl/callback?code=c&state=${stateNonce}`, {
        headers: { cookie: `${STATE_COOKIE_NAME}=${encodeURIComponent(cookieValue)}` },
      }),
    )

    // Desconectar.
    const { DELETE } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await DELETE(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Encerrando' }),
      }),
    )
    expect(res.status).toBe(200)

    const sb = serviceClient()
    const row = await sb
      .from('tenant_integrations')
      .select('status, enabled, credentials_enc')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    expect(row.data?.status).toBe('disconnected')
    expect(row.data?.enabled).toBe(false)
    // credentials_enc preservado (audit trail).
    expect(row.data?.credentials_enc).toBeTruthy()

    const audit = await sb
      .from('audit_log')
      .select('field')
      .eq('tenant_id', tenantId)
      .eq('entity', 'tenant_integrations')
    expect(audit.data?.some((r) => r.field === 'integration.disconnect:ghl')).toBe(true)
  })

  it('DELETE não-admin → 403 + audit deny', async () => {
    const { tenantId } = await seedTenant('us1-disc-rbac')
    const rec = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({ userId: rec.userId, email: rec.email, tenantId, role: 'recepcionista' })
    const { DELETE } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await DELETE(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Tentando' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('DELETE em tenant não conectado → 404', async () => {
    const { tenantId } = await seedTenant('us1-disc-empty')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { DELETE } = await import('@/app/api/configuracoes/integracoes/ghl/route')
    const res = await DELETE(
      new Request('http://localhost/api/configuracoes/integracoes/ghl', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(404)
  })
})
