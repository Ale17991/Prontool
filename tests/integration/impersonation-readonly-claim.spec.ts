/**
 * Segurança — o claim INVIOLÁVEL `app_metadata.impersonation=true` no JWT marca
 * a sessão como READ-ONLY (o middleware bloqueia escrita com base nele). Injetado
 * pelo auth hook no caminho cross-tenant (1b: platform-admin assumindo clínica
 * sem vínculo).
 *
 * Migration 0171 ("Super escolhe ao entrar"): o super-admin passou a entrar COM
 * edição por padrão (sem o claim). Só fica read-only quando escolhe "Só
 * visualizar" — sinalizado por `user_metadata.support_view_tenant_id = <alvo>`.
 * Suporte (não-super) segue SEMPRE read-only, independente da flag.
 *
 * Exercemos `auth_hook_custom_claims` diretamente com um evento sintético do
 * GoTrue e conferimos os claims resultantes.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'

interface AppMeta {
  tenant_id?: string
  role?: string
  impersonation?: boolean
}

async function runHook(
  userId: string,
  activeTenant: string,
  opts?: { viewTenant?: string },
): Promise<AppMeta> {
  const userMetadata: Record<string, unknown> = { active_tenant_id: activeTenant }
  if (opts?.viewTenant) userMetadata.support_view_tenant_id = opts.viewTenant
  const sb = serviceClient()
  const { data, error } = await sb.rpc(
    'auth_hook_custom_claims' as never,
    {
      event: {
        user_id: userId,
        user_metadata: userMetadata,
        claims: {},
      },
    } as never,
  )
  if (error) throw new Error(`auth_hook_custom_claims failed: ${error.message}`)
  const result = data as { claims?: { app_metadata?: AppMeta } }
  return result.claims?.app_metadata ?? {}
}

describe('impersonação read-only — claim app_metadata.impersonation (0171)', () => {
  let superId: string
  let supportId: string
  let memberId: string
  let homeTenant: string
  let targetTenant: string

  beforeAll(async () => {
    await resetDatabase()
    homeTenant = (await seedTenant('imp-home')).tenantId
    targetTenant = (await seedTenant('imp-target')).tenantId

    // Super-admin de plataforma: tem uma clínica "casa" (vínculo), mas NÃO é
    // membro de targetTenant — entrar nela é cross-tenant.
    superId = (await seedUser(homeTenant, 'admin', 'imp-super')).userId
    await serviceClient()
      .from('platform_admins')
      .insert({ user_id: superId, is_super: true } as never)
      .throwOnError()

    // Suporte (NÃO-super): membro de homeTenant, atribuído a targetTenant via
    // platform_admin_tenants — entrar em targetTenant é cross-tenant de suporte.
    supportId = (await seedUser(homeTenant, 'admin', 'imp-support')).userId
    await serviceClient()
      .from('platform_admins')
      .insert({ user_id: supportId, is_super: false } as never)
      .throwOnError()
    await serviceClient()
      .from('platform_admin_tenants')
      .insert({ user_id: supportId, tenant_id: targetTenant } as never)
      .throwOnError()

    // Membro legítimo (admin) de targetTenant — nunca é impersonação.
    memberId = (await seedUser(targetTenant, 'admin', 'imp-member')).userId
  })

  it('super cross-tenant SEM flag ⇒ EDIÇÃO (sem impersonation), role=admin, tenant alvo', async () => {
    const am = await runHook(superId, targetTenant)
    expect(am.tenant_id).toBe(targetTenant)
    expect(am.role).toBe('admin')
    expect(am.impersonation).toBeUndefined()
  })

  it('super cross-tenant com support_view_tenant_id=alvo ⇒ impersonation=true (Só visualizar)', async () => {
    const am = await runHook(superId, targetTenant, { viewTenant: targetTenant })
    expect(am.tenant_id).toBe(targetTenant)
    expect(am.role).toBe('admin')
    expect(am.impersonation).toBe(true)
  })

  it('suporte (não-super) cross-tenant ⇒ impersonation=true SEMPRE, mesmo sem flag', async () => {
    const am = await runHook(supportId, targetTenant)
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
