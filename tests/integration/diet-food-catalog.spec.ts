/**
 * T023 (Feature 047 US1) — catálogo de alimentos ponta a ponta (domínio).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { searchFoods } from '@/lib/core/nutrition/foods/search'
import { createCustomFood, updateCustomFood, deactivateCustomFood } from '@/lib/core/nutrition/foods/custom'

describe('Feature 047 US1 — catálogo de alimentos', () => {
  let tenantId: string
  let actorUserId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('food-cat')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId
  })

  it('busca no catálogo global (acento-insensível)', async () => {
    const sb = serviceClient()
    const r = await searchFoods(sb, { tenantId, query: 'acucar', limit: 10 })
    expect(r.length).toBeGreaterThan(0)
    expect(r.some((f) => /açúcar|acucar/i.test(f.name))).toBe(true)
  })

  it('cadastra alimento próprio; energia derivada por Atwater', async () => {
    const sb = serviceClient()
    const created = await createCustomFood(sb, {
      tenantId,
      actorUserId,
      name: 'Whey isolado — Marca X',
      groupSlug: 'carnes_ovos',
      referenceGrams: 30,
      energyKcal: null,
      proteinG: 24,
      carbG: 1,
      fatG: 0.5,
      measures: [{ label: 'scoop', grams: 30, isDefault: true }],
    })
    // 4*24 + 4*1 + 9*0.5 = 104.5
    expect(created.energyKcal).toBe(104.5)

    const found = await searchFoods(sb, { tenantId, query: 'whey', scope: 'custom' })
    const mine = found.find((f) => f.id === created.id)
    expect(mine?.isCustom).toBe(true)
    expect(mine?.measures.some((m) => m.label === 'Scoop' || m.label === 'scoop')).toBe(true)
  })

  it('rejeita valor implausível (422)', async () => {
    const sb = serviceClient()
    await expect(
      createCustomFood(sb, {
        tenantId,
        actorUserId,
        name: 'Absurdo',
        referenceGrams: 100,
        energyKcal: 9000,
        proteinG: 1,
        carbG: 1,
        fatG: 1,
      }),
    ).rejects.toThrow()
  })

  it('editar/desativar alimento GLOBAL é recusado', async () => {
    const sb = serviceClient()
    const g = await sb.from('foods').select('id').is('tenant_id', null).limit(1).single()
    const globalId = (g.data as { id: string }).id
    await expect(updateCustomFood(sb, { tenantId, foodId: globalId, name: 'x' })).rejects.toThrow()
    await expect(deactivateCustomFood(sb, { tenantId, foodId: globalId })).rejects.toThrow()
  })

  it('desativa o próprio alimento (lógico) e ele sai da busca', async () => {
    const sb = serviceClient()
    const created = await createCustomFood(sb, {
      tenantId,
      actorUserId,
      name: 'Temporário',
      referenceGrams: 100,
      energyKcal: 50,
      proteinG: 1,
      carbG: 10,
      fatG: 0,
    })
    await deactivateCustomFood(sb, { tenantId, foodId: created.id })
    const found = await searchFoods(sb, { tenantId, query: 'temporário', scope: 'custom' })
    expect(found.find((f) => f.id === created.id)).toBeUndefined()
  })
})
