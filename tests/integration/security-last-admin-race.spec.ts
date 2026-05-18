/**
 * Regressão do fix H2 — is_last_active_admin com FOR UPDATE row-lock.
 *
 * Antes (0064): função STABLE SQL com `SELECT NOT EXISTS (...)` sem lock.
 * Em duas transações concorrentes desativando duas admins do mesmo tenant
 * (READ COMMITTED default), cada uma via a outra ainda ativa, ambas
 * passavam, e o tenant ficava com 0 admins ativos.
 *
 * Agora (0088): VOLATILE plpgsql com `SELECT ... FOR UPDATE`. A segunda
 * transação bloqueia na row da primeira admin (a row que ela quer SELECT
 * está com lock pelo UPDATE da outra trans); ao desbloquear, vê o
 * estado pós-commit e o trigger rejeita.
 *
 * Resultado esperado: exatamente UMA admin desativada, a outra continua
 * ativa, e a falha aparece como check_violation com mensagem de
 * "única administradora ativa".
 *
 * Cada chamada `.update(...)` via supabase-js → HTTP → PostgREST cria sua
 * própria transação na pool de conexões PG. Promise.all com duas chamadas
 * reproduz a race.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'

describe('security: is_last_active_admin race protection (H2)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('dois UPDATEs concorrentes desativando duas admins → exatamente 1 sucesso', async () => {
    const { tenantId } = await seedTenant('h2-race')
    const adminA = await seedUser(tenantId, 'admin', 'admin-a')
    const adminB = await seedUser(tenantId, 'admin', 'admin-b')

    const sb = serviceClient()
    const ts = new Date().toISOString()

    // Race: disable A e disable B em paralelo.
    const [resA, resB] = await Promise.all([
      sb
        .from('user_tenants')
        .update({ status: 'disabled', disabled_at: ts, disabled_by: adminA.userId })
        .eq('tenant_id', tenantId)
        .eq('user_id', adminA.userId),
      sb
        .from('user_tenants')
        .update({ status: 'disabled', disabled_at: ts, disabled_by: adminB.userId })
        .eq('tenant_id', tenantId)
        .eq('user_id', adminB.userId),
    ])

    const successes = [resA.error === null, resB.error === null].filter(Boolean).length
    const failures = [resA.error, resB.error].filter((e) => e !== null)

    // Invariante: exatamente UMA passou. (Antes do fix, AMBAS poderiam
    // passar — race exploitable. Após o fix, a 2ª é serializada e bloqueada.)
    expect(successes).toBe(1)
    expect(failures.length).toBe(1)

    // A falha veio do trigger enforce_last_admin (ERRCODE check_violation
    // = '23514' em supabase-js → code '23514' ou mensagem casando).
    const failureMsg = failures[0]!.message
    expect(failureMsg).toMatch(/administradora ativa|check_violation|enforce_last_admin/i)

    // Estado final: 1 admin ativa, 1 disabled.
    const { data: rows } = await sb
      .from('user_tenants')
      .select('user_id, status')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin')

    const activeCount = (rows ?? []).filter(
      (r) => (r as { status: string }).status === 'active',
    ).length
    expect(activeCount).toBe(1)
  })

  it('UPDATE sequencial: primeira passa, segunda falha (sanity sem race)', async () => {
    // Sanity: a regra "não desativar a última admin" continua valendo no
    // caminho serial — fix de race não desabilita a checagem normal.
    const { tenantId } = await seedTenant('h2-sequential')
    const adminA = await seedUser(tenantId, 'admin', 'admin-a')
    const adminB = await seedUser(tenantId, 'admin', 'admin-b')

    const sb = serviceClient()
    const ts = new Date().toISOString()

    // Disable A primeiro — passa (B ainda admin ativa).
    const { error: errA } = await sb
      .from('user_tenants')
      .update({ status: 'disabled', disabled_at: ts, disabled_by: adminA.userId })
      .eq('tenant_id', tenantId)
      .eq('user_id', adminA.userId)
    expect(errA).toBeNull()

    // Tentar disable B agora — falha (B é a única admin ativa).
    const { error: errB } = await sb
      .from('user_tenants')
      .update({ status: 'disabled', disabled_at: ts, disabled_by: adminB.userId })
      .eq('tenant_id', tenantId)
      .eq('user_id', adminB.userId)
    expect(errB).not.toBeNull()
    expect(errB!.message).toMatch(/administradora ativa|check_violation/i)
  })

  it('com 3 admins, dois UPDATEs concorrentes (sobra >=1) → ambos passam', async () => {
    // Garantia: o lock só "morde" quando a operação ameaça deixar 0 admins.
    // Com 3 admins, duas remoções concorrentes deixam 1 e devem passar.
    const { tenantId } = await seedTenant('h2-three-admins')
    const a = await seedUser(tenantId, 'admin', 'a')
    const b = await seedUser(tenantId, 'admin', 'b')
    const c = await seedUser(tenantId, 'admin', 'c')
    void c // só para ficar 3 admins; não tocamos nela.

    const sb = serviceClient()
    const ts = new Date().toISOString()

    const [resA, resB] = await Promise.all([
      sb
        .from('user_tenants')
        .update({ status: 'disabled', disabled_at: ts, disabled_by: a.userId })
        .eq('tenant_id', tenantId)
        .eq('user_id', a.userId),
      sb
        .from('user_tenants')
        .update({ status: 'disabled', disabled_at: ts, disabled_by: b.userId })
        .eq('tenant_id', tenantId)
        .eq('user_id', b.userId),
    ])

    expect(resA.error).toBeNull()
    expect(resB.error).toBeNull()

    const { data: active } = await sb
      .from('user_tenants')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin')
      .eq('status', 'active')
    expect((active ?? []).length).toBe(1)
  })
})
