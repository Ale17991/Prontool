/**
 * Meta por refeição — persistência.
 *
 * O que importa aqui é a distinção entre "sem meta" (NULL) e "meta de 0%".
 * Se o banco ou o domínio confundirem os dois, toda refeição nova nasceria
 * cobrada de uma meta de não comer nada.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { saveDietPlanDraft, getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'

describe('distribuição de macros — meta por refeição', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string
  let foodId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('meal-target-pct')).tenantId
    actorUserId = (await seedUser(tenantId, 'admin')).userId
    patientId = await seedPatient(tenantId)

    const sb = serviceClient()
    const f = await sb
      .from('foods')
      .insert({
        tenant_id: null,
        source: 'af_bdalimentos',
        external_code: 'mtp-1',
        name: 'Arroz cozido',
        reference_grams: 100,
        energy_kcal: 128,
        protein_g: 2.5,
        carb_g: 28,
        fat_g: 0.2,
        fiber_g: 1.6,
        active: true,
      } as never)
      .select('id')
      .single()
    if (f.error) throw new Error(f.error.message)
    foodId = (f.data as { id: string }).id
  })

  it('grava e devolve o percentual de cada refeição', async () => {
    const sb = serviceClient()
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano com distribuição',
      meals: [
        { name: 'Café', position: 0, targetPct: 25, items: [{ foodId, grams: 100 }] },
        { name: 'Almoço', position: 1, targetPct: 40, items: [{ foodId, grams: 150 }] },
        { name: 'Jantar', position: 2, targetPct: 35, items: [{ foodId, grams: 120 }] },
      ],
      nutrients: null,
    })

    const plan = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(plan?.meals.map((m) => m.targetPct)).toEqual([25, 40, 35])
    expect(plan!.meals.reduce((s, m) => s + (m.targetPct ?? 0), 0)).toBe(100)
  })

  it('refeição sem meta volta NULL, e não zero', async () => {
    const sb = serviceClient()
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano sem distribuição',
      meals: [
        { name: 'Café', position: 0, items: [{ foodId, grams: 100 }] },
        { name: 'Almoço', position: 1, targetPct: 0, items: [{ foodId, grams: 150 }] },
      ],
      nutrients: null,
    })

    const plan = await getDietPlanForPatient(sb, tenantId, patientId)
    // Não informada → sem meta.
    expect(plan?.meals[0]?.targetPct).toBeNull()
    // Informada como 0 → meta de fato, preservada.
    expect(plan?.meals[1]?.targetPct).toBe(0)
  })

  it('o banco recusa percentual fora de 0–100', async () => {
    const sb = serviceClient()
    const plan = await getDietPlanForPatient(sb, tenantId, patientId)
    const res = await sb
      .from('diet_meals')
      .update({ target_pct: 140 } as never)
      .eq('id', plan!.meals[0]!.id)
    expect(res.error).not.toBeNull()
  })
})
