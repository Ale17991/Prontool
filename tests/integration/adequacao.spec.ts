/**
 * T017 (Feature 049 US2) — DRIs no banco + adequação do plano ponta a ponta.
 * Self-contained: insere a DRI e o alimento com micros (reset trunca a tabela).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { saveDietPlanDraft, getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'
import { listDRIsForPatient } from '@/lib/core/nutrition/dri/read'
import { computeAdequacy } from '@/lib/core/nutrition/adequacy'

describe('Feature 049 US2 — adequação plano × DRI', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string
  let foodId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('adequacao')).tenantId
    actorUserId = (await seedUser(tenantId, 'admin')).userId
    patientId = await seedPatient(tenantId)

    const sb = serviceClient()
    const f = await sb
      .from('foods')
      .insert({
        tenant_id: null,
        source: 'af_bdalimentos',
        external_code: 'adq1',
        name: 'Fígado (rico em ferro)',
        reference_grams: 100,
        energy_kcal: 130,
        protein_g: 20,
        carb_g: 0,
        fat_g: 4,
        fiber_g: 0,
        micronutrients: { ferro_mg: 6 },
        active: true,
      } as never)
      .select('id')
      .single()
    if (f.error) throw new Error(f.error.message)
    foodId = (f.data as { id: string }).id

    // DRI de ferro p/ homem 19-30 = 8 mg (a tabela é truncada no reset).
    const d = await sb.from('dietary_reference_intakes').insert({
      nutrient_key: 'ferro',
      sex: 'M',
      age_min_years: 19,
      age_max_years: 30,
      state: 'padrao',
      value: 8,
      unit: 'mg',
    } as never)
    if (d.error) throw new Error(d.error.message)
  })

  it('lê a DRI da faixa e classifica a adequação do plano', async () => {
    const sb = serviceClient()
    // 200 g do fígado → 12 mg de ferro (6 mg/100g × 2).
    await saveDietPlanDraft(sb, {
      tenantId,
      patientId,
      actorUserId,
      title: 'Plano ferro',
      meals: [{ name: 'Almoço', position: 0, items: [{ foodId, grams: 200 }] }],
    })
    const view = await getDietPlanForPatient(sb, tenantId, patientId)
    expect(view!.totals.micros!.ferro_mg).toBeCloseTo(12, 6)

    const dris = await listDRIsForPatient(sb, { ageYears: 25, sex: 'M' })
    expect(dris.get('ferro')?.value).toBe(8)

    const adq = computeAdequacy(view!.totals, dris)
    const ferro = adq.items.find((i) => i.nutrientKey === 'ferro')!
    expect(ferro.total).toBe(12)
    expect(ferro.dri).toBe(8)
    expect(ferro.pct).toBe(150) // 12/8
    expect(ferro.class).toBe('acima')
  })
})
