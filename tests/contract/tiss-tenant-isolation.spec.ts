/**
 * T011 (Feature 029) — Princípio III: isolamento multi-tenant das tabelas TISS.
 *
 * Dados de faturamento TISS do tenant A são invisíveis ao tenant B via RLS, e
 * o tenant B não consegue inserir linha escopada ao tenant A.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, serviceClient, rlsClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 029 — isolamento multi-tenant TISS', () => {
  let tenantA: string
  let tenantB: string
  let planA: string
  let adminAId: string
  let jwtB: string

  beforeAll(async () => {
    await resetDatabase()
    const a = await seedTenant('tiss-iso-a')
    tenantA = a.tenantId
    const adminA = await seedUser(tenantA, 'admin')
    adminAId = adminA.userId
    planA = await seedHealthPlan(tenantA, 'Operadora A')

    const b = await seedTenant('tiss-iso-b')
    tenantB = b.tenantId
    const adminB = await seedUser(tenantB, 'admin')
    jwtB = mintJwt({ userId: adminB.userId, email: adminB.email, tenantId: tenantB, role: 'admin' })

    // Semeia dados TISS para o tenant A (service role bypassa RLS).
    const sb = serviceClient()
    await sb
      .from('tenant_tiss_operator_config' as never)
      .insert({
        tenant_id: tenantA,
        health_plan_id: planA,
        ans_registration: '123456',
        contracted_code: 'CTR-A',
        contracted_cnpj: '00000000000191',
        created_by_user_id: adminAId,
      } as never)
      .throwOnError()
    await sb
      .from('tiss_lotes' as never)
      .insert({
        tenant_id: tenantA,
        health_plan_id: planA,
        lote_number: 'L-A-0001',
        created_by_user_id: adminAId,
      } as never)
      .throwOnError()
  })

  it('tenant B não enxerga a config TISS do tenant A', async () => {
    const sbB = rlsClient(jwtB)
    const { data, error } = await sbB.from('tenant_tiss_operator_config' as never).select('id')
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('tenant B não enxerga os lotes do tenant A', async () => {
    const sbB = rlsClient(jwtB)
    const { data, error } = await sbB.from('tiss_lotes' as never).select('id')
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('tenant B não consegue inserir lote escopado ao tenant A', async () => {
    const sbB = rlsClient(jwtB)
    const res = await sbB.from('tiss_lotes' as never).insert({
      tenant_id: tenantA,
      health_plan_id: planA,
      lote_number: 'L-CROSS-0001',
      created_by_user_id: adminAId,
    } as never)
    expect(res.error).toBeTruthy() // RLS WITH CHECK barra tenant cruzado
  })
})
