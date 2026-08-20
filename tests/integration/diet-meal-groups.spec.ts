/**
 * Feature 047 — grupos (listas de substituição / "OU") adicionados às refeições.
 * Grupo conta como 1 porção por reference_kcal; prescrição congela; portal mostra
 * as opções de troca.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { createEquivalenceList } from '@/lib/core/nutrition/foods/equivalence'
import { saveDietPlanDraft, getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'
import { prescribeDietPlan } from '@/lib/core/nutrition/diet/prescribe'
import { getPortalDietPlan } from '@/lib/core/patient-portal/diet'

async function pickFoods(sb: ReturnType<typeof serviceClient>, likes: string[]) {
  const out: { id: string }[] = []
  for (const like of likes) {
    const { data } = await sb
      .from('foods')
      .select('id')
      .is('tenant_id', null)
      .ilike('name', `%${like}%`)
      .limit(1)
      .single()
    out.push(data as { id: string })
  }
  return out
}

describe('Feature 047 — grupo (lista OU) na refeição', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string
  let listId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('diet-groups')).tenantId
    actorUserId = (await seedUser(tenantId, 'admin')).userId
    patientId = await seedPatient(tenantId)

    const sb = serviceClient()
    const [arroz, batata] = await pickFoods(sb, ['arroz', 'batata'])
    const created = await createEquivalenceList(sb, {
      tenantId,
      groupSlug: 'cereais_paes',
      name: 'Carboidratos ~80 kcal',
      referenceKcal: 80,
      items: [
        { foodId: arroz!.id, grams: 65 },
        { foodId: batata!.id, grams: 100 },
      ],
    })
    listId = created.id
  })

  it('grupo na refeição conta energia = reference_kcal e expõe as opções OU', async () => {
    const sb = serviceClient()
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano com grupo',
      meals: [
        {
          name: 'Almoço',
          position: 0,
          items: [{ equivalenceListId: listId, notes: 'Carboidratos ~80 kcal' }],
        },
      ],
    })

    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(view).not.toBeNull()
    const item = view!.meals[0]!.items[0]!
    expect(item.isGroup).toBe(true)
    expect(item.equivalenceListId).toBe(listId)
    expect(item.nutrients?.energyKcal).toBe(80)
    expect(item.groupOptions).not.toBeNull()
    expect(item.groupOptions!.length).toBe(2)
    // total do dia inclui o grupo
    expect(view!.totals.energyKcal).toBe(80)
  })

  it('prescrever congela o grupo e o snapshot leva as opções ao portal', async () => {
    const sb = serviceClient()
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    await prescribeDietPlan(sb, { tenantId, patientId, actorUserId, planId: view!.id })

    const portal = await getPortalDietPlan(sb, tenantId, patientId)
    expect(portal).not.toBeNull()
    const pItem = portal!.meals[0]!.items[0]!
    expect(pItem.name).toBe('Carboidratos ~80 kcal')
    expect(pItem.nutrients?.energyKcal).toBe(80)
    expect(pItem.options).not.toBeNull()
    expect(pItem.options!.length).toBe(2)
  })

  it('opções do grupo são editáveis por paciente (remove batata, adiciona frango)', async () => {
    const sb = serviceClient()
    const [arroz, , frango] = await pickFoods(sb, ['arroz', 'batata', 'frango'])
    const batata = (await pickFoods(sb, ['batata']))[0]!
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano custom',
      meals: [
        {
          name: 'Almoço',
          position: 0,
          items: [
            {
              equivalenceListId: listId,
              notes: 'Carboidratos ~80 kcal',
              groupOptions: [
                { foodId: arroz!.id, grams: 65 },
                { foodId: frango!.id, grams: 40 },
              ],
            },
          ],
        },
      ],
    })
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    const item = view!.meals[0]!.items[0]!
    expect(item.isGroup).toBe(true)
    // energia contada segue = meta da lista (reference_kcal), estável
    expect(item.nutrients?.energyKcal).toBe(80)
    expect(item.groupReferenceKcal).toBe(80)
    const optIds = item.groupOptions!.map((o) => o.foodId)
    expect(optIds).toContain(arroz!.id)
    expect(optIds).toContain(frango!.id)
    expect(optIds).not.toContain(batata.id) // removida só para este paciente
  })
})
