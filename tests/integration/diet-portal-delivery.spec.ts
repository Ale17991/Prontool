/**
 * T039 (Feature 047 US4) — entrega do plano prescrito no portal.
 * O portal lê a prescrição mais recente; rascunho não aparece; o conteúdo
 * bate com o prescrito (SC-007).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { saveDietPlanDraft, getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'
import { prescribeDietPlan } from '@/lib/core/nutrition/diet/prescribe'
import { getPortalDietPlan } from '@/lib/core/patient-portal/diet'

async function arroz(sb: ReturnType<typeof serviceClient>) {
  const { data } = await sb.from('foods').select('id').is('tenant_id', null).ilike('name', '%arroz%').limit(1).single()
  return (data as { id: string }).id
}

describe('Feature 047 US4 — entrega no portal', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('diet-portal')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId
    patientId = await seedPatient(tenantId)
  })

  it('rascunho 047 NÃO aparece no portal', async () => {
    const sb = serviceClient()
    const foodId = await arroz(sb)
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Rascunho',
      meals: [{ name: 'Almoço', position: 0, items: [{ foodId, grams: 100 }] }],
    })
    const portal = await getPortalDietPlan(sb, tenantId, patientId)
    expect(portal).toBeNull()
  })

  it('após prescrever, o portal mostra exatamente o prescrito (SC-007)', async () => {
    const sb = serviceClient()
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    const res = await prescribeDietPlan(sb, { tenantId, patientId, actorUserId, planId: view!.id })

    const portal = await getPortalDietPlan(sb, tenantId, patientId)
    expect(portal).not.toBeNull()
    expect(portal!.prescribedAt).toBeTruthy()
    expect(portal!.totalKcal).toBeCloseTo(res.totalKcal, 6)
    expect(portal!.meals).toHaveLength(1)
    expect(portal!.meals[0]!.name).toBe('Almoço')
    expect(portal!.meals[0]!.items[0]!.name.toLowerCase()).toContain('arroz')
    expect(portal!.attribution).toBe(true)
  })

  it('editar o plano após prescrever (novo rascunho) NÃO altera o que o portal mostra', async () => {
    const sb = serviceClient()
    const foodId = await arroz(sb)
    // Nova versão em rascunho.
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Nova versão não prescrita',
      meals: [{ name: 'Jantar', position: 0, items: [{ foodId, grams: 300 }] }],
    })
    // O portal continua mostrando a prescrição anterior (Almoço), não o rascunho.
    const portal = await getPortalDietPlan(sb, tenantId, patientId)
    expect(portal!.meals[0]!.name).toBe('Almoço')
  })
})
