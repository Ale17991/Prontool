/**
 * T012 (Feature 029) — Princípio V: RBAC no nível das policies RLS.
 *
 * - tenant_tiss_operator_config: só `admin` escreve (config da operadora).
 * - tiss_lotes: `admin` e `financeiro` escrevem; `recepcionista` e
 *   `profissional_saude` não.
 *
 * (Os testes de RBAC no nível de endpoint/`requireRole` — com audit deny —
 * entram junto com os Route Handlers em US1+.)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient, rlsClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

describe('Feature 029 — RBAC (policies RLS) TISS', () => {
  let tenantId: string
  let planId: string
  const jwts: Partial<Record<TenantRole, string>> = {}
  const userIds: Partial<Record<TenantRole, string>> = {}

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('tiss-rbac')
    tenantId = t.tenantId
    planId = await seedHealthPlan(tenantId, 'Operadora RBAC')
    for (const role of [
      'admin',
      'financeiro',
      'recepcionista',
      'profissional_saude',
    ] as TenantRole[]) {
      const u = await seedUser(tenantId, role)
      userIds[role] = u.userId
      jwts[role] = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
    }
    // garante service_role disponível
    void serviceClient()
  })

  it('config da operadora: admin insere; financeiro é barrado', async () => {
    const okAdmin = await rlsClient(jwts.admin!)
      .from('tenant_tiss_operator_config' as never)
      .insert({
        tenant_id: tenantId,
        health_plan_id: planId,
        ans_registration: '123456',
        contracted_code: 'CTR-ADM',
        contracted_cnpj: '00000000000191',
        created_by_user_id: userIds.admin!,
      } as never)
    expect(okAdmin.error).toBeNull()

    const denyFin = await rlsClient(jwts.financeiro!)
      .from('tenant_tiss_operator_config' as never)
      .insert({
        tenant_id: tenantId,
        health_plan_id: planId,
        ans_registration: '654321',
        contracted_code: 'CTR-FIN',
        contracted_cnpj: '00000000000191',
        created_by_user_id: userIds.financeiro!,
      } as never)
    expect(denyFin.error).toBeTruthy() // só admin
  })

  it('lotes: financeiro insere; recepcionista e profissional_saude são barrados', async () => {
    const okFin = await rlsClient(jwts.financeiro!)
      .from('tiss_lotes' as never)
      .insert({
        tenant_id: tenantId,
        health_plan_id: planId,
        lote_number: 'L-FIN-0001',
        created_by_user_id: userIds.financeiro!,
      } as never)
    expect(okFin.error).toBeNull()

    const denyRecep = await rlsClient(jwts.recepcionista!)
      .from('tiss_lotes' as never)
      .insert({
        tenant_id: tenantId,
        health_plan_id: planId,
        lote_number: 'L-REC-0001',
        created_by_user_id: userIds.recepcionista!,
      } as never)
    expect(denyRecep.error).toBeTruthy()

    const denyProf = await rlsClient(jwts.profissional_saude!)
      .from('tiss_lotes' as never)
      .insert({
        tenant_id: tenantId,
        health_plan_id: planId,
        lote_number: 'L-PRO-0001',
        created_by_user_id: userIds.profissional_saude!,
      } as never)
    expect(denyProf.error).toBeTruthy()
  })
})
