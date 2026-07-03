/**
 * Feature 008 — US5: customMenuSetup fallback gracioso.
 *
 * Cobre:
 *   - 404 do GHL → menu_status='unsupported', restante segue.
 *   - 201 OK → menu_id persistido + menu_status='registered'.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant } from '@/tests/helpers/seed-factories'
import { mswServer } from '@/tests/helpers/msw-server'
import { customMenuSetup } from '@/lib/integrations/ghl/oauth/custom-menu-setup'

async function seedRow(slug: string, locationId: string) {
  const { tenantId } = await seedTenant(slug)
  const sb = serviceClient()
  await sb.from('tenant_integrations').insert({
    tenant_id: tenantId,
    provider: 'ghl',
    config: { location_id: locationId, sub_account_name: slug },
    credentials_enc: 'placeholder' as unknown as string,
    enabled: true,
    status: 'connected',
  })
  return tenantId
}

describe('US5 — customMenuSetup', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('GHL retorna 404 → menu_status=unsupported (não bloqueia)', async () => {
    const tenantId = await seedRow('us5-menu-404', 'loc_us5_404')
    mswServer.use(
      http.post(
        'https://services.leadconnectorhq.com/custom-menus/',
        () => new HttpResponse('not found', { status: 404 }),
      ),
    )
    const result = await customMenuSetup(
      serviceClient(),
      tenantId,
      'at_test',
      'loc_us5_404',
      'http://localhost:3000',
    )
    expect(result.status).toBe('unsupported')
    expect(result.menuId).toBeNull()

    const sb = serviceClient()
    const row = await sb
      .from('tenant_integrations')
      .select('config')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    const cfg = row.data?.config as Record<string, unknown>
    expect(cfg.menu_status).toBe('unsupported')
  })

  it('GHL retorna 201 → menu_status=registered + menu_id persistido', async () => {
    const tenantId = await seedRow('us5-menu-ok', 'loc_us5_ok')
    mswServer.use(
      http.post('https://services.leadconnectorhq.com/custom-menus/', () =>
        HttpResponse.json({ id: 'menu_us5_ok' }, { status: 201 }),
      ),
    )
    const result = await customMenuSetup(
      serviceClient(),
      tenantId,
      'at_test',
      'loc_us5_ok',
      'http://localhost:3000',
    )
    expect(result.status).toBe('registered')
    expect(result.menuId).toBe('menu_us5_ok')

    const sb = serviceClient()
    const row = await sb
      .from('tenant_integrations')
      .select('config')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    const cfg = row.data?.config as Record<string, unknown>
    expect(cfg.menu_status).toBe('registered')
    expect(cfg.menu_id).toBe('menu_us5_ok')
  })

  it('GHL retorna 5xx → menu_status=failed (não bloqueia)', async () => {
    const tenantId = await seedRow('us5-menu-5xx', 'loc_us5_5xx')
    mswServer.use(
      http.post(
        'https://services.leadconnectorhq.com/custom-menus/',
        () => new HttpResponse('upstream', { status: 502 }),
      ),
    )
    const result = await customMenuSetup(
      serviceClient(),
      tenantId,
      'at_test',
      'loc_us5_5xx',
      'http://localhost:3000',
    )
    expect(result.status).toBe('failed')
  })
})

describe('US5 — /api/sso/ghl', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('Sem context_token → 400', async () => {
    const { GET } = await import('@/app/api/sso/ghl/route')
    const res = await GET(new Request('http://localhost/api/sso/ghl'))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('CONTEXT_TOKEN_MISSING')
  })

  it('Token malformado → 401 INVALID_CONTEXT_TOKEN', async () => {
    const { GET } = await import('@/app/api/sso/ghl/route')
    const res = await GET(new Request('http://localhost/api/sso/ghl?context_token=not-a-jwt'))
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_CONTEXT_TOKEN')

    // Body NUNCA contém o token bruto.
    const text = JSON.stringify(body)
    expect(text).not.toContain('not-a-jwt')
  })
})
