/**
 * Feature 049 US1 — micronutrientes fluem da base para a busca e para a soma do
 * plano. Self-contained: cria um alimento global com micros (não depende do
 * import da base AF).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { searchFoods } from '@/lib/core/nutrition/foods/search'
import { saveDietPlanDraft, getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'

describe('Feature 049 US1 — micronutrientes na base e na soma', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string
  let foodId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('foods-micros')).tenantId
    actorUserId = (await seedUser(tenantId, 'admin')).userId
    patientId = await seedPatient(tenantId)

    const sb = serviceClient()
    const { data, error } = await sb
      .from('foods')
      .insert({
        tenant_id: null,
        source: 'af_bdalimentos',
        external_code: 'tm1',
        name: 'Alimento Teste Micros',
        reference_grams: 100,
        energy_kcal: 100,
        protein_g: 5,
        carb_g: 10,
        fat_g: 2,
        fiber_g: 1,
        micronutrients: { ferro_mg: 2, calcio_mg: 40 },
        active: true,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    foodId = (data as { id: string }).id
  })

  it('a busca retorna os micronutrientes do alimento', async () => {
    const sb = serviceClient()
    const results = await searchFoods(sb, { tenantId, query: 'Alimento Teste Micros' })
    const f = results.find((x) => x.id === foodId)
    expect(f).toBeTruthy()
    expect(f!.micronutrients).not.toBeNull()
    expect(f!.micronutrients!.ferro_mg).toBe(2)
    expect(f!.micronutrients!.calcio_mg).toBe(40)
  })

  it('o total do plano soma os micros por regra de três', async () => {
    const sb = serviceClient()
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano micros',
      meals: [{ name: 'Almoço', position: 0, items: [{ foodId, grams: 200 }] }],
    })
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(view).not.toBeNull()
    // 200 g de um alimento com ref 100 g → fator 2
    expect(view!.totals.micros).toBeTruthy()
    expect(view!.totals.micros!.ferro_mg).toBeCloseTo(4, 6)
    expect(view!.totals.micros!.calcio_mg).toBeCloseTo(80, 6)
  })
})
