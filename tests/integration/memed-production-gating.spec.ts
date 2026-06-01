/**
 * US5 (Feature 026) — homologação → produção + termo de responsabilidade.
 *  - Trocar para produção SEM termo → MEMED_TERMS_REQUIRED (e a constraint do
 *    banco também recusaria).
 *  - Aceitar termo → setMemedEnvironment('production') passa; ambiente gravado.
 *  - getPrescriberToken em produção sem termo é bloqueado.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { connectMemed } from '@/lib/core/integrations/memed/connect'
import { acceptMemedTerms, setMemedEnvironment } from '@/lib/core/integrations/memed/environment'

async function connected(slug: string) {
  const sb = serviceClient()
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  await connectMemed({
    supabase: sb,
    tenantId,
    credentials: { api_key: 'k', secret_key: 's' },
    actorUserId: admin.userId,
    actorLabel: `user:${admin.email}`,
  })
  return { sb, tenantId, admin }
}

describe('Feature 026 — produção exige termo (US5)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('bloqueia produção sem termo aceito', async () => {
    const { sb, tenantId, admin } = await connected('memed-prod-noterm')
    await expect(
      setMemedEnvironment({
        supabase: sb,
        tenantId,
        environment: 'production',
        actorUserId: admin.userId,
        actorLabel: `user:${admin.email}`,
      }),
    ).rejects.toMatchObject({ code: 'MEMED_TERMS_REQUIRED' })
  })

  it('aceita termo e então ativa produção', async () => {
    const { sb, tenantId, admin } = await connected('memed-prod-ok')

    const termo = await acceptMemedTerms({
      supabase: sb,
      tenantId,
      actorUserId: admin.userId,
      actorLabel: `user:${admin.email}`,
    })
    expect(termo.termsAcceptedAt).toBeTruthy()

    const result = await setMemedEnvironment({
      supabase: sb,
      tenantId,
      environment: 'production',
      actorUserId: admin.userId,
      actorLabel: `user:${admin.email}`,
    })
    expect(result.environment).toBe('production')

    const { data } = await sb
      .from('tenant_memed_config')
      .select('environment, terms_accepted_at, terms_accepted_by')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    expect((data as { environment?: string } | null)?.environment).toBe('production')
    expect((data as { terms_accepted_at?: string } | null)?.terms_accepted_at).toBeTruthy()
    expect((data as { terms_accepted_by?: string } | null)?.terms_accepted_by).toBe(admin.userId)
  })
})
