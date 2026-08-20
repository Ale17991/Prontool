/**
 * T031 (Feature 046 US3) — histórico: 2+ avaliações → `list` ordenado (mais
 * recente primeiro) + série dos derivados nas medições ao longo do tempo.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { createNutritionAssessment } from '@/lib/core/nutrition/assessments/create'
import { listNutritionAssessments } from '@/lib/core/nutrition/assessments/list'
import { listMeasurements } from '@/lib/core/patient-portal/measurements'

const METRICS = [
  { metric_type: 'peso', label: 'Peso', unit: 'kg', min_plausible: 2, max_plausible: 400 },
  {
    metric_type: 'taxa_metabolica_basal',
    label: 'TMB',
    unit: 'kcal',
    min_plausible: 500,
    max_plausible: 5000,
  },
  {
    metric_type: 'gasto_energetico_total',
    label: 'GET',
    unit: 'kcal',
    min_plausible: 500,
    max_plausible: 8000,
  },
]

describe('Feature 046 US3 — histórico e evolução', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('na-history')).tenantId
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

  it('duas avaliações → lista ordenada (recente primeiro) + série de GET nas medições', async () => {
    const sb = serviceClient()
    // Avaliação mais antiga.
    await createNutritionAssessment(sb, {
      tenantId,
      patientId,
      actorUserId,
      assessedAt: '2026-06-01',
      sex: 'M',
      ageYears: 30,
      weightKg: 85,
      heightCm: 180,
      tmbEquation: 'mifflin',
      activityFactor: 1.55,
    })
    // Avaliação mais recente.
    await createNutritionAssessment(sb, {
      tenantId,
      patientId,
      actorUserId,
      assessedAt: '2026-07-01',
      sex: 'M',
      ageYears: 30,
      weightKg: 80,
      heightCm: 180,
      tmbEquation: 'mifflin',
      activityFactor: 1.55,
    })

    const history = await listNutritionAssessments(sb, { tenantId, patientId })
    expect(history).toHaveLength(2)
    // Mais recente primeiro.
    expect(history[0]?.assessedAt).toBe('2026-07-01')
    expect(history[1]?.assessedAt).toBe('2026-06-01')

    // Série do GET com dois pontos (um por avaliação).
    const grouped = await listMeasurements(sb, { tenantId, patientId })
    const getSeries = grouped['gasto_energetico_total'] ?? []
    expect(getSeries).toHaveLength(2)
    // Peso evoluiu de 85 → 80 (dois pontos distintos).
    const pesoSeries = (grouped['peso'] ?? []).map((m) => m.value)
    expect(pesoSeries).toContain(85)
    expect(pesoSeries).toContain(80)
  })
})
