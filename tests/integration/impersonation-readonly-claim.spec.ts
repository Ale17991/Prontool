/**
 * Segurança (revisão 2026-07, migration 0167) — a impersonação READ-ONLY é
 * marcada por um claim INVIOLÁVEL `app_metadata.impersonation=true` no JWT,
 * injetado pelo auth hook APENAS no caminho cross-tenant (1b: platform-admin
 * assumindo clínica sem vínculo). Antes, o read-only dependia só do cookie
 * `clinni_impersonation`, que o super-admin (dono do browser) podia apagar.
 *
 * Aqui exercemos a função `auth_hook_custom_claims` diretamente com um evento
 * sintético do GoTrue e conferimos os claims resultantes.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'

interface AppMeta {
  tenant_id?: string
  role?: string
  impersonation?: boolean
}

async function runHook(userId: string, activeTenant: string): Promise<AppMeta> {
  const sb = serviceClient()
  const { data, error } = await sb.rpc(
    'auth_hook_custom_claims' as never,
    {
      event: {
        user_id: userId,
        user_metadata: { active_tenant_id: activeTenant },
        claims: {},
      },
    } as never,
  )
  if (error) throw new Error(`auth_hook_custom_claims failed: ${error.message}`)
  const result = data as { claims?: { app_metadata?: AppMeta } }
  return result.claims?.app_metadata ?? {}
}

describe('impersonação read-only — claim app_metadata.impersonation (0167)', () => {
  let superId: string
  let memberId: string
  let homeTenant: string
  let targetTenant: string

  beforeAll(async () => {
    await resetDatabase()
    homeTenant = (await seedTenant('imp-home')).tenantId
    targetTenant = (await seedTenant('imp-target')).tenantId

    // Super-admin de plataforma: tem uma clínica "casa" (vínculo), mas NÃO é
    // membro de targetTenant — entrar nela é cross-tenant (impersonação).
    superId = (await seedUser(homeTenant, 'admin', 'imp-super')).userId
    await serviceClient()
      .from('platform_admins')
      .insert({ user_id: superId, is_super: true } as never)
      .throwOnError()

    // Membro legítimo (admin) de targetTenant — NÃO é impersonação.
    memberId = (await seedUser(targetTenant, 'admin', 'imp-member')).userId
  })

  it('cross-tenant (super sem vínculo) ⇒ impersonation=true, role=admin, tenant alvo', async () => {
    const am = await runHook(superId, targetTenant)
    expect(am.tenant_id).toBe(targetTenant)
    expect(am.role).toBe('admin')
    expect(am.impersonation).toBe(true)
  })

  it('membro legítimo do tenant ⇒ SEM claim de impersonation', async () => {
    const am = await runHook(memberId, targetTenant)
    expect(am.tenant_id).toBe(targetTenant)
    expect(am.role).toBe('admin')
    expect(am.impersonation).toBeUndefined()
  })

  it('super entrando na PRÓPRIA clínica (com vínculo) ⇒ SEM impersonation', async () => {
    const am = await runHook(superId, homeTenant)
    expect(am.tenant_id).toBe(homeTenant)
    expect(am.impersonation).toBeUndefined()
  })
})
