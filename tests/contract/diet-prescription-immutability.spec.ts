/**
 * T025 (Feature 047 US2) — imutabilidade da prescrição (Constituição I).
 * diet_plan_prescriptions rejeita UPDATE/DELETE; plano prescrito não muda
 * quando o alimento de origem é editado (SC-004).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { createCustomFood, updateCustomFood } from '@/lib/core/nutrition/foods/custom'
import { saveDietPlanDraft, getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'
import { prescribeDietPlan } from '@/lib/core/nutrition/diet/prescribe'

describe('Feature 047 — imutabilidade da prescrição', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string
  let jwt: string
  let prescriptionId: string
  let foodId: string
  let frozenKcal: number

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('diet-immut')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId
    jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    patientId = await seedPatient(tenantId)

    const sb = serviceClient()
    const food = await createCustomFood(sb, {
      tenantId,
      actorUserId,
      name: 'Alimento base',
      referenceGrams: 100,
      energyKcal: 200,
      proteinG: 10,
      carbG: 20,
      fatG: 5,
    })
    foodId = food.id
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano',
      meals: [{ name: 'Almoço', position: 0, items: [{ foodId, grams: 100 }] }],
    })
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    const res = await prescribeDietPlan(sb, { tenantId, patientId, actorUserId, planId: view!.id })
    prescriptionId = res.prescriptionId
    frozenKcal = res.totalKcal
    expect(frozenKcal).toBe(200)
  })

  it('UPDATE em diet_plan_prescriptions é rejeitado', async () => {
    const rls = rlsClient(jwt)
    const { error } = await rls
      .from('diet_plan_prescriptions')
      .update({ total_kcal: 1 } as never)
      .eq('id', prescriptionId)
    expect(error).toBeTruthy()
  })

  it('DELETE em diet_plan_prescriptions é rejeitado', async () => {
    const rls = rlsClient(jwt)
    const { error } = await rls.from('diet_plan_prescriptions').delete().eq('id', prescriptionId)
    expect(error).toBeTruthy()
  })

  it('editar o alimento NÃO muda o plano prescrito (SC-004)', async () => {
    const sb = serviceClient()
    // Dobra a energia do alimento.
    await updateCustomFood(sb, {
      tenantId,
      foodId,
      energyKcal: 400,
      proteinG: 10,
      carbG: 20,
      fatG: 5,
    })
    // A prescrição (snapshot) mantém o valor congelado.
    const presc = await sb
      .from('diet_plan_prescriptions')
      .select('total_kcal')
      .eq('id', prescriptionId)
      .single()
    expect(Number((presc.data as { total_kcal: number }).total_kcal)).toBe(frozenKcal)

    // E os itens congelados também.
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(view!.status).toBe('prescrito')
    expect(view!.totals.energyKcal).toBe(frozenKcal)
  })
})
