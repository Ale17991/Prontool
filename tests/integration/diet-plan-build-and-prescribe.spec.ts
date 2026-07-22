/**
 * T034 (Feature 047 US2) — montar plano, conferir totais, prescrever.
 * Total do plano bate com a soma; prescrever cria snapshot + status prescrito;
 * plano sem avaliação monta sem delta (edge case).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { saveDietPlanDraft, getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'
import { prescribeDietPlan } from '@/lib/core/nutrition/diet/prescribe'

async function pickFood(sb: ReturnType<typeof serviceClient>, like: string) {
  const { data } = await sb
    .from('foods')
    .select('id, name, reference_grams, energy_kcal, protein_g')
    .is('tenant_id', null)
    .ilike('name', `%${like}%`)
    .limit(1)
    .single()
  return data as { id: string; name: string; reference_grams: number; energy_kcal: number; protein_g: number }
}

describe('Feature 047 US2 — montar e prescrever plano alimentar', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('diet-build')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId
    patientId = await seedPatient(tenantId)
  })

  it('monta o cardápio e os totais batem com a soma dos itens', async () => {
    const sb = serviceClient()
    const arroz = await pickFood(sb, 'arroz')
    const grams = 150

    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano teste',
      meals: [
        { name: 'Almoço', position: 0, items: [{ foodId: arroz.id, grams }] },
      ],
    })

    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(view).not.toBeNull()
    expect(view!.status).toBe('rascunho')
    const factor = grams / Number(arroz.reference_grams)
    const expectedKcal = Math.round(Number(arroz.energy_kcal) * factor * 100) / 100
    expect(view!.totals.energyKcal).toBeCloseTo(expectedKcal, 1)
    // total do dia = total da (única) refeição
    expect(view!.meals[0]!.totals.energyKcal).toBeCloseTo(view!.totals.energyKcal, 6)
  })

  it('editar o rascunho substitui o cardápio (não acumula)', async () => {
    const sb = serviceClient()
    const frango = await pickFood(sb, 'frango')
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano teste',
      meals: [{ name: 'Jantar', position: 0, items: [{ foodId: frango.id, grams: 120 }] }],
    })
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(view!.meals).toHaveLength(1)
    expect(view!.meals[0]!.name).toBe('Jantar')
  })

  it('prescreve: cria snapshot, congela nutrientes e marca prescrito', async () => {
    const sb = serviceClient()
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    const planId = view!.id
    const totalBefore = view!.totals.energyKcal

    const result = await prescribeDietPlan(sb, { tenantId, patientId, actorUserId, planId })
    expect(result.prescriptionId).toBeTruthy()
    expect(result.totalKcal).toBeCloseTo(totalBefore, 6)

    const after = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(after!.status).toBe('prescrito')

    const presc = await sb
      .from('diet_plan_prescriptions')
      .select('id, total_kcal, snapshot')
      .eq('plan_id', planId)
      .single()
    expect(presc.data).toBeTruthy()

    // Item congelado (snap_* preenchido).
    const items = await sb
      .from('diet_meal_items')
      .select('snap_energy_kcal')
      .eq('tenant_id', tenantId)
      .not('snap_energy_kcal', 'is', null)
    expect((items.data ?? []).length).toBeGreaterThan(0)
  })

  it('prescrever de novo o mesmo plano → 409 (já prescrito)', async () => {
    const sb = serviceClient()
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    await expect(
      prescribeDietPlan(sb, { tenantId, patientId, actorUserId, planId: view!.id }),
    ).rejects.toThrow(/prescrito|already/i)
  })

  it('editar após prescrever cria nova versão (rascunho)', async () => {
    const sb = serviceClient()
    const arroz = await pickFood(sb, 'arroz')
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Nova versão',
      meals: [{ name: 'Café', position: 0, items: [{ foodId: arroz.id, grams: 50 }] }],
    })
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(view!.status).toBe('rascunho')
    expect(view!.title).toBe('Nova versão')
  })

  it('plano sem avaliação monta sem delta', async () => {
    const sb = serviceClient()
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(view!.target).toBeNull()
    expect(view!.delta).toBeNull()
  })
})
