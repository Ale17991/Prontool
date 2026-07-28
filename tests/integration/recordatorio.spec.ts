/**
 * T025 (Feature 049 US3) — recordatório: montar/salvar, totais (com micros)
 * batendo, isolamento entre tenants.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { saveRecall, listRecalls, getRecall } from '@/lib/core/nutrition/recall/plan'

describe('Feature 049 US3 — recordatório R24h', () => {
  let tenantA: string
  let tenantB: string
  let patientA: string
  let actorA: string
  let foodId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('recall-a')).tenantId
    tenantB = (await seedTenant('recall-b')).tenantId
    actorA = (await seedUser(tenantA, 'admin')).userId
    patientA = await seedPatient(tenantA)

    const sb = serviceClient()
    const f = await sb
      .from('foods')
      .insert({
        tenant_id: null,
        source: 'af_bdalimentos',
        external_code: 'rec1',
        name: 'Ovo (rec)',
        reference_grams: 100,
        energy_kcal: 143,
        protein_g: 13,
        carb_g: 1,
        fat_g: 10,
        fiber_g: 0,
        micronutrients: { ferro_mg: 1.8 },
        active: true,
      } as never)
      .select('id')
      .single()
    if (f.error) throw new Error(f.error.message)
    foodId = (f.data as { id: string }).id
  })

  it('salva e soma energia + micros por regra de três', async () => {
    const sb = serviceClient()
    const { id } = await saveRecall(sb, {
      tenantId: tenantA,
      patientId: patientA,
      actorUserId: actorA,
      recallDate: '2026-07-27',
      meals: [{ name: 'Café', position: 0, items: [{ foodId, grams: 200 }] }],
    })
    const view = await getRecall(sb, tenantA, id)
    expect(view!.totals.energyKcal).toBeCloseTo(286, 0) // 143 × 2
    expect(view!.totals.micros!.ferro_mg).toBeCloseTo(3.6, 6) // 1.8 × 2
  })

  it('substitui o recordatório do mesmo dia (um por data)', async () => {
    const sb = serviceClient()
    await saveRecall(sb, {
      tenantId: tenantA,
      patientId: patientA,
      actorUserId: actorA,
      recallDate: '2026-07-27',
      meals: [{ name: 'Almoço', position: 0, items: [{ foodId, grams: 100 }] }],
    })
    const { summaries } = await listRecalls(sb, tenantA, patientA)
    const doDia = summaries.filter((s) => s.recallDate === '2026-07-27')
    expect(doDia).toHaveLength(1)
    expect(doDia[0]!.totalKcal).toBeCloseTo(143, 0)
  })

  it('isolamento: outro tenant não enxerga o recordatório', async () => {
    const sb = serviceClient()
    const { summaries } = await listRecalls(sb, tenantB, patientA)
    expect(summaries).toHaveLength(0)
  })
})
