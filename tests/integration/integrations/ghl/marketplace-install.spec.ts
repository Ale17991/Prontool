/**
 * Feature 008 — US2: Marketplace install/uninstall webhooks.
 *
 * Cobre:
 *   - POST /install com HMAC válido em location nova → cria tenant +
 *     tenant_integrations conectado.
 *   - Replay com mesmo eventId → duplicate:true.
 *   - 2º install em location_id já mapeada → atualiza tokens, mesmo tenant_id.
 *   - Assinatura inválida → 401.
 *   - Timestamp fora da janela → 401.
 *   - Body sem refresh_token → 400.
 *   - POST /uninstall happy → enabled=false, status=disconnected, dados preservados.
 *   - Uninstall em location desconhecida → 200 no_match.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'

const SHARED_SECRET = process.env.GHL_MARKETPLACE_SHARED_SECRET ?? 'test_marketplace_shared_secret_min_32_chars_xxxx'

interface SignedRequest {
  body: string
  signature: string
  timestamp: string
}

function signBody(body: string, opts: { skewSeconds?: number } = {}): SignedRequest {
  const ts = String(Math.floor(Date.now() / 1000) + (opts.skewSeconds ?? 0))
  const sig = createHmac('sha256', SHARED_SECRET).update(body, 'utf8').digest('hex').toLowerCase()
  return { body, signature: sig, timestamp: ts }
}

interface InstallPayloadOverrides {
  eventId?: string
  locationId?: string
  locationName?: string
  timezone?: string | null
  accessToken?: string
  refreshToken?: string
  scope?: string
  expiresIn?: number
  companyId?: string
  userId?: string
  omitRefreshToken?: boolean
}

function makeInstallPayload(o: InstallPayloadOverrides = {}): string {
  const tokens: Record<string, unknown> = {
    access_token:
      o.accessToken ?? 'at_install_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    expires_in: o.expiresIn ?? 86400,
    scope: o.scope ?? 'contacts.readonly contacts.write',
  }
  if (!o.omitRefreshToken) {
    tokens.refresh_token =
      o.refreshToken ?? 'rt_install_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  }
  return JSON.stringify({
    eventId: o.eventId ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: 'INSTALL',
    appId: 'app_clinni_test',
    companyId: o.companyId ?? 'comp_us2_default',
    locationId: o.locationId ?? 'loc_us2_default',
    location: {
      id: o.locationId ?? 'loc_us2_default',
      name: o.locationName ?? 'Clínica Test',
      timezone: o.timezone === undefined ? 'America/Sao_Paulo' : o.timezone,
      countryCode: 'BR',
    },
    user: {
      id: o.userId ?? 'usr_us2_default',
      email: 'admin@clinic.test',
      firstName: 'Test',
      lastName: 'Admin',
      type: 'Location',
    },
    tokens,
    installedAt: new Date().toISOString(),
  })
}

interface UninstallPayloadOverrides {
  eventId?: string
  locationId?: string
  reason?: string
}

function makeUninstallPayload(o: UninstallPayloadOverrides = {}): string {
  return JSON.stringify({
    eventId: o.eventId ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: 'UNINSTALL',
    appId: 'app_clinni_test',
    companyId: 'comp_us2_default',
    locationId: o.locationId ?? 'loc_us2_default',
    uninstalledAt: new Date().toISOString(),
    reason: o.reason ?? 'user_request',
  })
}

async function postInstall(req: SignedRequest): Promise<Response> {
  const { POST } = await import('@/app/api/webhooks/ghl/install/route')
  return POST(
    new Request('http://localhost/api/webhooks/ghl/install', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wh-signature': req.signature,
        'x-wh-timestamp': req.timestamp,
      },
      body: req.body,
    }),
  )
}

async function postUninstall(req: SignedRequest): Promise<Response> {
  const { POST } = await import('@/app/api/webhooks/ghl/uninstall/route')
  return POST(
    new Request('http://localhost/api/webhooks/ghl/uninstall', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wh-signature': req.signature,
        'x-wh-timestamp': req.timestamp,
      },
      body: req.body,
    }),
  )
}

describe('US2 — /api/webhooks/ghl/install,uninstall', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('INSTALL happy → cria tenant + tenant_integrations + audit_log + sync_log', async () => {
    const body = makeInstallPayload({
      eventId: 'evt_us2_first',
      locationId: 'loc_us2_first',
      locationName: 'Clínica Primeira',
    })
    const res = await postInstall(signBody(body))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { received: boolean; duplicate: boolean; tenant_id: string }
    expect(j.received).toBe(true)
    expect(j.duplicate).toBe(false)
    expect(j.tenant_id).toBeTruthy()

    const sb = serviceClient()
    const tenant = await sb.from('tenants').select('id, name').eq('id', j.tenant_id).single()
    expect(tenant.data?.name).toBe('Clínica Primeira')

    const integration = await sb
      .from('tenant_integrations')
      .select('status, enabled, location_id, credentials_enc')
      .eq('tenant_id', j.tenant_id)
      .eq('provider', 'ghl')
      .single()
    expect(integration.data?.status).toBe('connected')
    expect(integration.data?.enabled).toBe(true)
    expect(integration.data?.location_id).toBe('loc_us2_first')

    const audit = await sb
      .from('audit_log')
      .select('field, actor_label')
      .eq('tenant_id', j.tenant_id)
      .eq('entity', 'tenant_integrations')
    expect(audit.data?.some((r) => r.field === 'integration.connect:ghl')).toBe(true)
    expect(audit.data?.[0]?.actor_label).toBe('system:ghl_marketplace_install')

    const syncLog = await sb
      .from('integration_sync_log')
      .select('kind, status')
      .eq('tenant_id', j.tenant_id)
      .eq('provider', 'ghl')
    expect(syncLog.data?.some((r) => r.kind === 'connect' && r.status === 'success')).toBe(true)
  })

  it('INSTALL replay com mesmo eventId → duplicate:true, sem novo tenant', async () => {
    const body = makeInstallPayload({
      eventId: 'evt_us2_dup',
      locationId: 'loc_us2_dup',
    })
    const r1 = await postInstall(signBody(body))
    const j1 = (await r1.json()) as { tenant_id: string }
    const r2 = await postInstall(signBody(body))
    expect(r2.status).toBe(200)
    const j2 = (await r2.json()) as { duplicate: boolean }
    expect(j2.duplicate).toBe(true)

    const sb = serviceClient()
    const tenants = await sb
      .from('tenant_integrations')
      .select('tenant_id')
      .eq('provider', 'ghl')
      .eq('location_id', 'loc_us2_dup')
    expect(tenants.data?.length).toBe(1)
    expect(tenants.data?.[0]?.tenant_id).toBe(j1.tenant_id)
  })

  it('INSTALL repetido em location já mapeada (eventId novo) → reusa tenant', async () => {
    const body1 = makeInstallPayload({
      eventId: 'evt_us2_remap1',
      locationId: 'loc_us2_remap',
      accessToken: 'at_first_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      refreshToken: 'rt_first_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    })
    const r1 = await postInstall(signBody(body1))
    const j1 = (await r1.json()) as { tenant_id: string }

    const body2 = makeInstallPayload({
      eventId: 'evt_us2_remap2',
      locationId: 'loc_us2_remap',
      accessToken: 'at_second_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      refreshToken: 'rt_second_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    })
    const r2 = await postInstall(signBody(body2))
    const j2 = (await r2.json()) as { tenant_id: string; duplicate: boolean }
    expect(r2.status).toBe(200)
    expect(j2.duplicate).toBe(false)
    expect(j2.tenant_id).toBe(j1.tenant_id) // Mesmo tenant.

    const sb = serviceClient()
    const tenants = await sb
      .from('tenant_integrations')
      .select('tenant_id, status')
      .eq('provider', 'ghl')
      .eq('location_id', 'loc_us2_remap')
    expect(tenants.data?.length).toBe(1)
    expect(tenants.data?.[0]?.status).toBe('connected')
  })

  it('Assinatura HMAC inválida → 401, sem efeito no banco', async () => {
    const body = makeInstallPayload({ locationId: 'loc_us2_badsig' })
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await postInstall({ body, signature: 'deadbeef'.repeat(8), timestamp: ts })
    expect(res.status).toBe(401)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('INVALID_SIGNATURE')

    const sb = serviceClient()
    const rows = await sb
      .from('tenant_integrations')
      .select('tenant_id')
      .eq('location_id', 'loc_us2_badsig')
    expect(rows.data?.length ?? 0).toBe(0)
  })

  it('Timestamp fora da janela → 401', async () => {
    const body = makeInstallPayload({ locationId: 'loc_us2_skew' })
    // 10 min de skew — fora da janela ±5 min.
    const res = await postInstall(signBody(body, { skewSeconds: 600 }))
    expect(res.status).toBe(401)
  })

  it('Body sem tokens.refresh_token → 400', async () => {
    const body = makeInstallPayload({
      locationId: 'loc_us2_norefresh',
      omitRefreshToken: true,
    })
    const res = await postInstall(signBody(body))
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('INVALID_BODY')
  })

  it('UNINSTALL happy → enabled=false, dados preservados', async () => {
    // Install primeiro.
    const installBody = makeInstallPayload({
      eventId: 'evt_us2_un_install',
      locationId: 'loc_us2_un',
    })
    const installRes = await postInstall(signBody(installBody))
    const { tenant_id: tenantId } = (await installRes.json()) as { tenant_id: string }

    // Uninstall.
    const uninstallBody = makeUninstallPayload({
      eventId: 'evt_us2_un_uninstall',
      locationId: 'loc_us2_un',
    })
    const res = await postUninstall(signBody(uninstallBody))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { received: boolean; tenant_id?: string }
    expect(j.received).toBe(true)
    expect(j.tenant_id).toBe(tenantId)

    const sb = serviceClient()
    const integration = await sb
      .from('tenant_integrations')
      .select('status, enabled, credentials_enc')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    expect(integration.data?.enabled).toBe(false)
    expect(integration.data?.status).toBe('disconnected')
    // credentials_enc preservado para audit.
    expect(integration.data?.credentials_enc).toBeTruthy()

    // Tenant ainda existe.
    const tenant = await sb.from('tenants').select('id').eq('id', tenantId).single()
    expect(tenant.data?.id).toBe(tenantId)

    const audit = await sb
      .from('audit_log')
      .select('field, actor_label')
      .eq('tenant_id', tenantId)
      .eq('entity', 'tenant_integrations')
    expect(audit.data?.some((r) => r.field === 'integration.disconnect:ghl')).toBe(true)
  })

  it('UNINSTALL em location desconhecida → 200 no_match', async () => {
    const body = makeUninstallPayload({ locationId: 'loc_us2_unknown' })
    const res = await postUninstall(signBody(body))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { received: boolean; no_match: boolean }
    expect(j.no_match).toBe(true)
  })

  it('UNINSTALL com assinatura inválida → 401', async () => {
    const body = makeUninstallPayload({ locationId: 'loc_us2_un_badsig' })
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await postUninstall({ body, signature: 'deadbeef'.repeat(8), timestamp: ts })
    expect(res.status).toBe(401)
  })
})
