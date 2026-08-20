/**
 * T019 (Feature 046) — salvar avaliação com composição → snapshot imutável +
 * derivados lançados no motor de medições.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { createNutritionAssessment } from '@/lib/core/nutrition/assessments/create'
import { listMeasurements } from '@/lib/core/patient-portal/measurements'

const METRICS = [
  { metric_type: 'peso', label: 'Peso', unit: 'kg', min_plausible: 2, max_plausible: 400 },
  { metric_type: 'imc', label: 'IMC', unit: 'kg/m²', min_plausible: 8, max_plausible: 90 },
  {
    metric_type: 'percentual_gordura',
    label: 'Gordura corporal',
    unit: '%',
    min_plausible: 3,
    max_plausible: 70,
  },
  {
    metric_type: 'massa_gorda_kg',
    label: 'Massa gorda',
    unit: 'kg',
    min_plausible: 0.3,
    max_plausible: 200,
  },
  {
    metric_type: 'massa_magra_kg',
    label: 'Massa magra',
    unit: 'kg',
    min_plausible: 5,
    max_plausible: 150,
  },
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

async function seedMetrics() {
  const sb = serviceClient()
  await sb
    .from('patient_metric_types')
    .upsert(
      METRICS.map((m, i) => ({ ...m, specialty: 'nutricao', display_order: i + 1 })) as never,
      { onConflict: 'metric_type', ignoreDuplicates: true },
    )
    .throwOnError()
}

describe('Feature 046 US1 — salvar composição corporal', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('na-comp')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId
    patientId = await seedPatient(tenantId)
    await seedMetrics()
  })

  it('calcula, grava o snapshot e lança os derivados nas medições', async () => {
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
      dobraProtocol: 'jp3',
      skinfolds: { peitoral: 12, abdominal: 20, coxa: 15 },
      circumferences: { cintura: 88, quadril: 100 },
    })
    expect(result.composition?.fatPct).toBeCloseTo(14.21, 1)
    expect(result.composition?.imc).toBeCloseTo(24.69, 1)
    expect(result.composition?.waistHipRatio).toBe(0.88)

    // Snapshot gravado.
    const { data: row } = await sb
      .from('nutrition_assessments')
      .select('id, fat_pct, dobra_protocol')
      .eq('id', result.id)
      .single()
    expect((row as unknown as { dobra_protocol: string }).dobra_protocol).toBe('jp3')

    // Derivados nas medições.
    const grouped = await listMeasurements(sb, { tenantId, patientId })
    expect(grouped['percentual_gordura']?.[0]?.value).toBeCloseTo(14.21, 1)
    expect(grouped['massa_magra_kg']?.length).toBeGreaterThan(0)
    expect(grouped['imc']?.[0]?.value).toBeCloseTo(24.69, 1)
  })
})
