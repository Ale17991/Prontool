/**
 * US5 (Feature 026/028) — produção exige chaves de PLATAFORMA (env) + termo.
 *  - Sem `MEMED_API_KEY`/`MEMED_SECRET_KEY` no env → ativar/trocar para produção
 *    falha com MEMED_PRODUCTION_NOT_CONFIGURED.
 *  - Com as env vars → ativa em produção e registra o aceite do termo.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { activateMemed } from '@/lib/core/integrations/memed/connect'
import { setMemedEnvironment } from '@/lib/core/integrations/memed/environment'

const PREV_API = process.env.MEMED_API_KEY
const PREV_SECRET = process.env.MEMED_SECRET_KEY

function restoreEnv() {
  if (PREV_API === undefined) delete process.env.MEMED_API_KEY
  else process.env.MEMED_API_KEY = PREV_API
  if (PREV_SECRET === undefined) delete process.env.MEMED_SECRET_KEY
  else process.env.MEMED_SECRET_KEY = PREV_SECRET
}

describe('Feature 028 — produção exige chaves de plataforma + termo', () => {
  beforeEach(async () => {
    await resetDatabase()
  })
  afterEach(() => {
    restoreEnv()
  })

  it('sem chaves de produção no env → ativar em produção falha', async () => {
    delete process.env.MEMED_API_KEY
    delete process.env.MEMED_SECRET_KEY
    const sb = serviceClient()
    const { tenantId } = await seedTenant('memed-prod-noenv')
    const admin = await seedUser(tenantId, 'admin')
    await expect(
      activateMemed({
        supabase: sb,
        tenantId,
        environment: 'production',
        actorUserId: admin.userId,
        actorLabel: `user:${admin.email}`,
      }),
    ).rejects.toMatchObject({ code: 'MEMED_PRODUCTION_NOT_CONFIGURED' })
  })

  it('sem chaves de produção → trocar ambiente p/ produção (após ativar staging) falha', async () => {
    delete process.env.MEMED_API_KEY
    delete process.env.MEMED_SECRET_KEY
    const sb = serviceClient()
    const { tenantId } = await seedTenant('memed-prod-switch')
    const admin = await seedUser(tenantId, 'admin')
    await activateMemed({
      supabase: sb,
      tenantId,
      environment: 'staging',
      actorUserId: admin.userId,
      actorLabel: `user:${admin.email}`,
    })
    await expect(
      setMemedEnvironment({
        supabase: sb,
        tenantId,
        environment: 'production',
        actorUserId: admin.userId,
        actorLabel: `user:${admin.email}`,
      }),
    ).rejects.toMatchObject({ code: 'MEMED_PRODUCTION_NOT_CONFIGURED' })
  })

  it('com chaves de produção no env → ativa em produção e registra termo', async () => {
    process.env.MEMED_API_KEY = 'prod_api_key_test'
    process.env.MEMED_SECRET_KEY = 'prod_secret_key_test'
    const sb = serviceClient()
    const { tenantId } = await seedTenant('memed-prod-ok')
    const admin = await seedUser(tenantId, 'admin')

    const result = await activateMemed({
      supabase: sb,
      tenantId,
      environment: 'production',
      actorUserId: admin.userId,
      actorLabel: `user:${admin.email}`,
    })
    expect(result.environment).toBe('production')

    const { data } = await sb
      .from('tenant_memed_config')
      .select('environment, terms_accepted_at, terms_accepted_by, connected')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    expect((data as { environment?: string } | null)?.environment).toBe('production')
    expect((data as { terms_accepted_at?: string } | null)?.terms_accepted_at).toBeTruthy()
    expect((data as { terms_accepted_by?: string } | null)?.terms_accepted_by).toBe(admin.userId)
    expect((data as { connected?: boolean } | null)?.connected).toBe(true)
  })
})
