/**
 * T035 (Feature 047 US3) — listas de substituição/equivalentes.
 * Criar lista da clínica; associar itens; leitura reflete; isolamento; a lista
 * global não é editável pela clínica.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import {
  createEquivalenceList,
  updateEquivalenceList,
  deleteEquivalenceList,
  listEquivalenceLists,
} from '@/lib/core/nutrition/foods/equivalence'

async function twoFoods(sb: ReturnType<typeof serviceClient>) {
  const { data } = await sb.from('foods').select('id').is('tenant_id', null).limit(2)
  const ids = (data as Array<{ id: string }>).map((r) => r.id)
  return ids
}

describe('Feature 047 US3 — listas de substituição', () => {
  let tenantA: string
  let tenantB: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('equiv-a')).tenantId
    tenantB = (await seedTenant('equiv-b')).tenantId
    await seedUser(tenantA, 'admin')
    await seedUser(tenantB, 'admin')
  })

  it('cria lista com itens e a leitura reflete', async () => {
    const sb = serviceClient()
    const [f1, f2] = await twoFoods(sb)
    const { id } = await createEquivalenceList(sb, {
      tenantId: tenantA,
      groupSlug: 'cereais_paes',
      name: 'Carboidratos — 1 porção (≈80 kcal)',
      referenceKcal: 80,
      items: [
        { foodId: f1!, grams: 65 },
        { foodId: f2!, grams: 50 },
      ],
    })
    const lists = await listEquivalenceLists(sb, tenantA)
    const mine = lists.find((l) => l.id === id)
    expect(mine).toBeTruthy()
    expect(mine!.isCustom).toBe(true)
    expect(mine!.items.length).toBe(2)
  })

  it('lista própria de A NÃO aparece para B (isolamento)', async () => {
    const sb = serviceClient()
    const [f1] = await twoFoods(sb)
    const { id } = await createEquivalenceList(sb, {
      tenantId: tenantA,
      groupSlug: 'frutas',
      name: 'Frutas A',
      items: [{ foodId: f1!, grams: 100 }],
    })
    const listsB = await listEquivalenceLists(sb, tenantB)
    expect(listsB.find((l) => l.id === id)).toBeUndefined()
  })

  it('atualiza a lista (substitui itens)', async () => {
    const sb = serviceClient()
    const [f1, f2] = await twoFoods(sb)
    const { id } = await createEquivalenceList(sb, {
      tenantId: tenantA,
      groupSlug: 'frutas',
      name: 'Editável',
      items: [{ foodId: f1!, grams: 100 }],
    })
    await updateEquivalenceList(sb, {
      tenantId: tenantA,
      listId: id,
      groupSlug: 'frutas',
      name: 'Editada',
      items: [{ foodId: f2!, grams: 120 }],
    })
    const lists = await listEquivalenceLists(sb, tenantA)
    const l = lists.find((x) => x.id === id)!
    expect(l.name).toBe('Editada')
    expect(l.items).toHaveLength(1)
    expect(l.items[0]!.grams).toBe(120)
  })

  it('B não edita nem apaga a lista de A', async () => {
    const sb = serviceClient()
    const [f1] = await twoFoods(sb)
    const { id } = await createEquivalenceList(sb, {
      tenantId: tenantA,
      groupSlug: 'frutas',
      name: 'De A',
      items: [{ foodId: f1!, grams: 100 }],
    })
    await expect(
      updateEquivalenceList(sb, { tenantId: tenantB, listId: id, groupSlug: 'frutas', name: 'hack', items: [] }),
    ).rejects.toThrow()
    await expect(deleteEquivalenceList(sb, { tenantId: tenantB, listId: id })).rejects.toThrow()
  })

  it('rejeita alimento de outra clínica na lista (FOOD_NOT_VISIBLE)', async () => {
    const sb = serviceClient()
    // Cria um alimento próprio de B e tenta usá-lo numa lista de A.
    const bFood = await sb
      .from('foods')
      .insert({
        tenant_id: tenantB,
        source: 'custom',
        name: 'Só de B',
        reference_grams: 100,
        energy_kcal: 100,
        protein_g: 1,
        carb_g: 1,
        fat_g: 1,
      } as never)
      .select('id')
      .single()
    const bFoodId = (bFood.data as { id: string }).id
    await expect(
      createEquivalenceList(sb, {
        tenantId: tenantA,
        groupSlug: 'frutas',
        name: 'Inválida',
        items: [{ foodId: bFoodId, grams: 100 }],
      }),
    ).rejects.toThrow()
  })
})
