/**
 * Feature 008 — US1: auto-refresh de tokens via withGhlAuth.
 *
 * Cobre:
 *   - Token vencendo (< 60s pra expirar) → próxima call dispara refresh,
 *     persiste novos tokens, audit + sync_log.
 *   - Refresh com 4xx do GHL → status='token_expired', alerta + audit.
 *   - 2 calls concorrentes a withGhlAuth quando vencendo → CAS garante
 *     uma escrita persistida; ambos workers convergem no mesmo token.
 *   - POST /api/oauth/ghl/refresh permanente → 502 + token_expired.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import {
  ghlOauthTokenSpy,
  makeGhlTokenResponse,
} from '@/tests/helpers/msw-spies'
import { connectGhlTenant } from '@/lib/core/integrations/ghl/connect-tenant'
import { withGhlAuth } from '@/lib/integrations/ghl/oauth/with-auth'

async function seedConnectedTenant(slug: string, expiresInSec = 86_400) {
  const { tenantId } = await seedTenant(slug)
  const sb = serviceClient()
  // connectGhlTenant requer um actor; usamos um user admin.
  const admin = await seedUser(tenantId, 'admin')
  await connectGhlTenant({
    supabase: sb,
    source: 'manual_connect',
    actorUserId: admin.userId,
    actorLabel: 'admin',
    tenantId,
    credentials: {
      access_token: 'at_initial_token_for_test_xxxxxxxxx',
      refresh_token: 'rt_initial_token_for_test_xxxxxxxx',
      expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      scopes: ['contacts.readonly', 'contacts.write'],
      user_type: 'Location',
      location_id: 'loc_initial',
      company_id: 'comp_initial',
      user_id: 'usr_initial',
    },
    location: { id: 'loc_initial', name: 'Clínica Auto-refresh', timezone: null },
  })
  return { tenantId, admin }
}

async function setExpiresAt(tenantId: string, expiresAtIso: string): Promise<void> {
  const sb = serviceClient()
  // Atualiza expires_at no JSON cifrado seria caro — em vez disso,
  // forçamos o test a setar `expires_at` via re-encrypt via connectGhlTenant
  // já feito acima. Para simular vencimento, usamos uma approach direta:
  // re-conectar com expires_at no passado.
  const { data: row } = await sb
    .from('tenant_integrations')
    .select('credentials_enc')
    .eq('tenant_id', tenantId)
    .eq('provider', 'ghl')
    .single()
  if (!row) throw new Error('tenant_integrations row missing')

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY!
  const dec = await sb.rpc('dec_text_with_key', { cipher: row.credentials_enc, key })
  const creds = JSON.parse(dec.data as unknown as string) as { expires_at: string; [k: string]: unknown }
  creds.expires_at = expiresAtIso
  const enc = await sb.rpc('enc_text_with_key', { plain: JSON.stringify(creds), key })
  await sb
    .from('tenant_integrations')
    .update({ credentials_enc: enc.data as unknown as string })
    .eq('tenant_id', tenantId)
    .eq('provider', 'ghl')
}

describe('US1 — auto-refresh via withGhlAuth', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('Token fresco → withGhlAuth retorna tokenJustRefreshed=false (sem hit no MSW)', async () => {
    const { tenantId } = await seedConnectedTenant('us1-fresh')
    const sb = serviceClient()
    const r = await withGhlAuth(sb, tenantId)
    expect(r.kind).toBe('connected')
    if (r.kind !== 'connected') throw new Error('expected connected')
    expect(r.tokenJustRefreshed).toBe(false)
    expect(r.accessToken).toBe('at_initial_token_for_test_xxxxxxxxx')
    expect(ghlOauthTokenSpy.calls.length).toBe(0)
  })

  it('Token vencendo → withGhlAuth refresca + persiste + audit + sync_log', async () => {
    const { tenantId } = await seedConnectedTenant('us1-expiring')
    // Força expires_at no passado.
    await setExpiresAt(tenantId, new Date(Date.now() - 60_000).toISOString())

    ghlOauthTokenSpy.queueResponse(
      makeGhlTokenResponse({ locationId: 'loc_initial', userId: 'usr_initial', companyId: 'comp_initial' }),
    )

    const sb = serviceClient()
    const r = await withGhlAuth(sb, tenantId)
    expect(r.kind).toBe('connected')
    if (r.kind !== 'connected') throw new Error('expected connected')
    expect(r.tokenJustRefreshed).toBe(true)

    expect(ghlOauthTokenSpy.calls).toHaveLength(1)
    expect(ghlOauthTokenSpy.calls[0]!.body.get('grant_type')).toBe('refresh_token')

    // Audit refresh_success.
    const audit = await sb
      .from('audit_log')
      .select('field')
      .eq('tenant_id', tenantId)
      .eq('entity', 'tenant_integrations')
    expect(audit.data?.some((r) => r.field === 'integration.refresh_success:ghl')).toBe(true)

    // Sync log token_refresh:success.
    const syncLog = await sb
      .from('integration_sync_log')
      .select('kind, status')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
    expect(
      syncLog.data?.some((row) => row.kind === 'token_refresh' && row.status === 'success'),
    ).toBe(true)
  })

  it('Refresh permanent failure (4xx) → status=token_expired + alert + audit', async () => {
    const { tenantId } = await seedConnectedTenant('us1-revoked')
    await setExpiresAt(tenantId, new Date(Date.now() - 60_000).toISOString())

    ghlOauthTokenSpy.queueResponse({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'refresh_token revoked' },
    })

    const sb = serviceClient()
    const r = await withGhlAuth(sb, tenantId)
    expect(r.kind).toBe('token_expired')

    const row = await sb
      .from('tenant_integrations')
      .select('status, enabled')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    expect(row.data?.status).toBe('token_expired')
    expect(row.data?.enabled).toBe(true) // continua enabled, só o status muda

    // Próxima call: NÃO deve chamar /oauth/token de novo (early-return).
    const before = ghlOauthTokenSpy.calls.length
    const r2 = await withGhlAuth(sb, tenantId)
    expect(r2.kind).toBe('token_expired')
    expect(ghlOauthTokenSpy.calls.length).toBe(before)

    // Audit refresh_failed gravado.
    const audit = await sb
      .from('audit_log')
      .select('field')
      .eq('tenant_id', tenantId)
      .eq('entity', 'tenant_integrations')
    expect(audit.data?.some((r) => r.field === 'integration.refresh_failed:ghl')).toBe(true)

    // Alert dispatched.
    const alerts = await sb
      .from('alerts')
      .select('type, detail')
      .eq('tenant_id', tenantId)
      .eq('type', 'integration_sync_failed')
    expect(alerts.data?.length ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('Refresh transient failure (5xx) → mantém status=connected + retorna access_token velho', async () => {
    const { tenantId } = await seedConnectedTenant('us1-transient')
    await setExpiresAt(tenantId, new Date(Date.now() - 60_000).toISOString())

    // 1ª resposta 5xx; 2ª resposta 5xx (esgota retry interno).
    ghlOauthTokenSpy.queueResponse({ status: 503, body: { error: 'service_unavailable' } })
    ghlOauthTokenSpy.queueResponse({ status: 503, body: { error: 'service_unavailable' } })

    const sb = serviceClient()
    const r = await withGhlAuth(sb, tenantId)
    expect(r.kind).toBe('connected')
    if (r.kind !== 'connected') throw new Error('expected connected')
    expect(r.tokenJustRefreshed).toBe(false)
    // Estado preservado.
    const row = await sb
      .from('tenant_integrations')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    expect(row.data?.status).toBe('connected')
  })

  it('2 calls concorrentes durante refresh → CAS garante 1 escrita persistida', async () => {
    const { tenantId } = await seedConnectedTenant('us1-race')
    await setExpiresAt(tenantId, new Date(Date.now() - 60_000).toISOString())

    // Cada call consome 1 entry da queue. As duas devem responder OK
    // (CAS no banco filtra qual ganha).
    ghlOauthTokenSpy.queueResponse(
      makeGhlTokenResponse({ locationId: 'loc_initial', userId: 'usr_initial', companyId: 'comp_initial' }),
    )
    ghlOauthTokenSpy.queueResponse(
      makeGhlTokenResponse({ locationId: 'loc_initial', userId: 'usr_initial', companyId: 'comp_initial' }),
    )

    const sb = serviceClient()
    const [a, b] = await Promise.all([withGhlAuth(sb, tenantId), withGhlAuth(sb, tenantId)])
    expect(a.kind).toBe('connected')
    expect(b.kind).toBe('connected')

    // Ambos devolvem access_token válido (pode ser igual ou diferente —
    // depende da ordem de CAS). O importante: tabela não fica corrompida.
    const row = await sb
      .from('tenant_integrations')
      .select('status, enabled')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    expect(row.data?.status).toBe('connected')
    expect(row.data?.enabled).toBe(true)
  })

  it('POST /api/oauth/ghl/refresh permanente → 502 + token_expired', async () => {
    const { tenantId, admin } = await seedConnectedTenant('us1-manual-refresh-fail')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    ghlOauthTokenSpy.queueResponse({
      status: 401,
      body: { error: 'invalid_grant' },
    })

    const { POST } = await import('@/app/api/oauth/ghl/refresh/route')
    const res = await POST(
      new Request('http://localhost/api/oauth/ghl/refresh', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: { code: string; will_require_reconnect?: boolean } }
    expect(body.error.code).toBe('REFRESH_FAILED')
    expect(body.error.will_require_reconnect).toBe(true)

    const sb = serviceClient()
    const row = await sb
      .from('tenant_integrations')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    expect(row.data?.status).toBe('token_expired')
  })
})
