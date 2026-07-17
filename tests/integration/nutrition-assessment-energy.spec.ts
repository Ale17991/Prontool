/**
 * T029 (Feature 046) — salvar avaliação com gasto energético → TMB/GET nas
 * medições; equação por massa magra sem composição → 422.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { createNutritionAssessment } from '@/lib/core/nutrition/assessments/create'
import { listMeasurements } from '@/lib/core/patient-portal/measurements'

const METRICS = [
  { metric_type: 'peso', label: 'Peso', unit: 'kg', min_plausible: 2, max_plausible: 400 },
  { metric_type: 'taxa_metabolica_basal', label: 'TMB', unit: 'kcal', min_plausible: 500, max_plausible: 5000 },
  { metric_type: 'gasto_energetico_total', label: 'GET', unit: 'kcal', min_plausible: 500, max_plausible: 8000 },
]

describe('Feature 046 US2 — salvar gasto energético', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('na-energy')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId
    patientId = await seedPatient(tenantId)
    const sb = serviceClient()
    await sb
      .from('patient_metric_types')
      .upsert(
        METRICS.map((m, i) => ({ ...m, specialty: 'nutricao', display_order: i + 20 })) as never,
        { onConflict: 'metric_type', ignoreDuplicates: true },
      )
      .throwOnError()
  })

  it('Mifflin → TMB/GET calculados e lançados nas medições', async () => {
    const sb = serviceClient()
    const result = await createNutritionAssessment(sb, {
      tenantId,
      patientId,
      actorUserId,
      assessedAt: '2026-07-17',
      sex: 'M',
      ageYears: 30,
      weightKg: 80,
      heightCm: 180,
      tmbEquation: 'mifflin',
      activityFactor: 1.55,
      objectiveDeltaKcal: -500,
      macros: { protPct: 30, carbPct: 40, lipPct: 30 },
    })
    expect(result.energy?.tmbKcal).toBe(1780)
    expect(result.energy?.getKcal).toBe(2759)
    expect(result.energy?.targetKcal).toBe(2259)

    const grouped = await listMeasurements(sb, { tenantId, patientId })
    expect(grouped['taxa_metabolica_basal']?.[0]?.value).toBe(1780)
    expect(grouped['gasto_energetico_total']?.[0]?.value).toBe(2759)
  })

  it('Katch-McArdle sem composição → 422 (massa magra)', async () => {
    const sb = serviceClient()
    await expect(
      createNutritionAssessment(sb, {
        tenantId,
        patientId,
        actorUserId,
        assessedAt: '2026-07-18',
        sex: 'M',
        ageYears: 30,
        weightKg: 80,
        heightCm: 180,
        tmbEquation: 'katch_mcardle',
      }),
    ).rejects.toThrow(/massa magra/i)
  })
})
