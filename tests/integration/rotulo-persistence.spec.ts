/**
 * T028 (Feature 052 US4) — salvar e reabrir sem perder nada.
 * Ingredientes, rendimento, porção, textos e sobrescritas voltam idênticos, e a
 * versão normativa é gravada na criação.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { createLabel, getLabel, updateLabel, listLabels, deleteLabel } from '@/lib/core/nutrition/labeling/store'
import { NORMATIVE_VERSION } from '@/lib/core/nutrition/labeling/reference'

async function seedFood(external: string, name: string): Promise<string> {
  const sb = serviceClient()
  const f = await sb
    .from('foods')
    .insert({
      tenant_id: null,
      source: 'af_bdalimentos',
      external_code: external,
      name,
      reference_grams: 100,
      energy_kcal: 200,
      protein_g: 5,
      carb_g: 30,
      fat_g: 6,
      fiber_g: 1.5,
      micronutrients: {
        acucar_total_g: 12,
        acucar_adicao_g: 10,
        ag_saturados_g: 3,
        ag_trans_g: 0,
        sodio_mg: 150,
      },
      active: true,
    } as never)
    .select('id')
    .single()
  if (f.error) throw new Error(`seed food: ${f.error.message}`)
  return (f.data as { id: string }).id
}

describe('Feature 052 US4 — persistência do rótulo', () => {
  let tenantId: string
  let actorUserId: string
  let foodA: string
  let foodB: string
  let labelId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('rotulo-persist')).tenantId
    actorUserId = (await seedUser(tenantId, 'admin')).userId
    foodA = await seedFood('rot-persist-a', 'Farinha integral')
    foodB = await seedFood('rot-persist-b', 'Açúcar mascavo')

    const sb = serviceClient()
    const created = await createLabel(sb, {
      tenantId,
      actorUserId,
      productName: 'Cookie integral',
      clientName: 'Padaria do Zé',
      basis: 'solido',
      totalYield: 800,
      portionSize: 30,
      householdMeasure: '1 unidade',
      portionsPerPackage: 12,
      ingredientsText: 'Farinha integral, açúcar mascavo, ovos.',
      allergensText: 'ALÉRGICOS: CONTÉM TRIGO E OVOS.',
      storageText: 'Conservar em local seco.',
      ingredients: [
        { foodId: foodA, grams: 500 },
        { foodId: foodB, grams: 200 },
      ],
    })
    labelId = created.id
  })

  it('grava a versão normativa na criação (FR-021)', async () => {
    const loaded = await getLabel(serviceClient(), tenantId, labelId)
    expect(loaded?.label.normativeVersion).toBe(NORMATIVE_VERSION)
    expect(loaded?.result.normativeVersion).toBe(NORMATIVE_VERSION)
  })

  it('reabre com todos os campos e ingredientes idênticos', async () => {
    const loaded = await getLabel(serviceClient(), tenantId, labelId)
    const l = loaded!.label
    expect(l.productName).toBe('Cookie integral')
    expect(l.clientName).toBe('Padaria do Zé')
    expect(l.basis).toBe('solido')
    expect(l.totalYield).toBe(800)
    expect(l.portionSize).toBe(30)
    expect(l.householdMeasure).toBe('1 unidade')
    expect(l.portionsPerPackage).toBe(12)
    expect(l.ingredientsText).toContain('Farinha integral')
    expect(l.allergensText).toContain('TRIGO')
    expect(l.storageText).toContain('local seco')
    expect(l.ingredients.map((i) => i.grams)).toEqual([500, 200])
    expect(l.ingredients.map((i) => i.name)).toEqual(['Farinha integral', 'Açúcar mascavo'])
    // Os nutrientes vêm junto para a tela recompor a tabela sem nova busca.
    expect(l.ingredients[0]?.food.energyKcal).toBe(200)
  })

  it('as sobrescritas voltam idênticas depois de reabrir', async () => {
    const sb = serviceClient()
    await updateLabel(sb, {
      tenantId,
      labelId,
      actorUserId,
      manualValues: { gorduras_trans: 0.3, acucares_adicionados: 22 },
    })
    const loaded = await getLabel(sb, tenantId, labelId)
    expect(loaded?.label.manualValues).toEqual({ gorduras_trans: 0.3, acucares_adicionados: 22 })
    const trans = loaded!.result.rows.find((r) => r.key === 'gorduras_trans')!
    expect(trans.state).toBe('sobrescrito')
    expect(trans.per100).toBe(0.3)
  })

  it('a lista traz o rótulo com o estado de completude real', async () => {
    const labels = await listLabels(serviceClient(), tenantId)
    const found = labels.find((l) => l.id === labelId)
    expect(found).toBeDefined()
    expect(found?.productName).toBe('Cookie integral')
    // Todos os obrigatórios resolvem (base completa + sobrescritas) → utilizável.
    expect(found?.incomplete).toBe(false)
  })

  it('remove o rótulo e seus ingredientes', async () => {
    const sb = serviceClient()
    expect(await deleteLabel(sb, tenantId, labelId)).toBe(true)
    expect(await getLabel(sb, tenantId, labelId)).toBeNull()
    const orphans = await sb
      .from('nutrition_label_ingredients')
      .select('id')
      .eq('label_id', labelId)
    expect((orphans.data ?? []).length).toBe(0)
    // Remover de novo não mente dizendo que apagou.
    expect(await deleteLabel(sb, tenantId, labelId)).toBe(false)
  })
})
