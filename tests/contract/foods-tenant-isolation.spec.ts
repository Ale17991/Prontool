/**
 * T013 (Feature 047 US1) — isolamento de tenant no catálogo de alimentos.
 * Catálogo global legível por dois tenants; alimento próprio de A invisível a
 * B; nenhum tenant edita/insere linha global (RLS + trigger da 0176).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { createCustomFood } from '@/lib/core/nutrition/foods/custom'

describe('Feature 047 — tenant isolation (foods)', () => {
  let tenantA: string
  let tenantB: string
  let aJwt: string
  let bJwt: string
  let customFoodA: string
  let globalFoodId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('food-iso-a')).tenantId
    tenantB = (await seedTenant('food-iso-b')).tenantId
    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    aJwt = mintJwt({ userId: adminA.userId, email: adminA.email, tenantId: tenantA, role: 'admin' })
    bJwt = mintJwt({ userId: adminB.userId, email: adminB.email, tenantId: tenantB, role: 'admin' })

    const sb = serviceClient()
    const created = await createCustomFood(sb, {
      tenantId: tenantA,
      actorUserId: adminA.userId,
      name: 'Whey secreto da clínica A',
      referenceGrams: 30,
      energyKcal: null,
      proteinG: 24,
      carbG: 1,
      fatG: 0.5,
    })
    customFoodA = created.id

    const g = await sb.from('foods').select('id').is('tenant_id', null).limit(1).single()
    globalFoodId = (g.data as { id: string }).id
  })

  it('o catálogo global é legível pelos dois tenants', async () => {
    for (const jwt of [aJwt, bJwt]) {
      const rls = rlsClient(jwt)
      const { data } = await rls.from('foods').select('id').is('tenant_id', null).limit(1)
      expect((data ?? []).length).toBe(1)
    }
  })

  it('tenant B NÃO enxerga o alimento próprio do tenant A', async () => {
    const rls = rlsClient(bJwt)
    const { data } = await rls.from('foods').select('id').eq('id', customFoodA)
    expect((data ?? []).length).toBe(0)
  })

  it('tenant A enxerga o próprio alimento', async () => {
    const rls = rlsClient(aJwt)
    const { data } = await rls.from('foods').select('id').eq('id', customFoodA)
    expect((data ?? []).length).toBe(1)
  })

  it('nenhum tenant edita uma linha GLOBAL (RLS + trigger)', async () => {
    const rls = rlsClient(aJwt)
    const { error, data } = await rls
      .from('foods')
      .update({ name: 'HACK' } as never)
      .eq('id', globalFoodId)
      .select('id')
    // RLS não deixa a linha global no escopo de UPDATE → 0 linhas afetadas (ou erro).
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('tenant B NÃO insere alimento no escopo do tenant A (RLS WITH CHECK)', async () => {
    const rls = rlsClient(bJwt)
    const { error } = await rls.from('foods').insert({
      tenant_id: tenantA,
      source: 'custom',
      name: 'intruso',
      reference_grams: 100,
      energy_kcal: 100,
      protein_g: 1,
      carb_g: 1,
      fat_g: 1,
    } as never)
    expect(error).toBeTruthy()
  })
})
