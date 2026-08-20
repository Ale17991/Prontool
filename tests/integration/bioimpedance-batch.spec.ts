/**
 * Bioimpedância — `recordMeasurementsBatch` grava uma sessão inteira de uma vez,
 * atômico: se qualquer valor estiver fora da faixa plausível, nada é gravado.
 *
 * As métricas de bioimpedância vêm da migration 0174 (catálogo global). O teste
 * auto-semeia as que usa para ficar imune à captura lazy do catalog_baseline
 * (0170) — em DB local antigo o baseline pode preceder a 0174.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedPatient } from '@/tests/helpers/seed-factories'
import { recordMeasurementsBatch, listMeasurements } from '@/lib/core/patient-portal/measurements'

const BIA_METRICS = [
  {
    metric_type: 'percentual_gordura',
    label: 'Gordura corporal',
    unit: '%',
    min_plausible: 3,
    max_plausible: 70,
  },
  {
    metric_type: 'massa_magra_kg',
    label: 'Massa magra',
    unit: 'kg',
    min_plausible: 5,
    max_plausible: 150,
  },
  {
    metric_type: 'gordura_visceral',
    label: 'Gordura visceral (nível)',
    unit: 'nível',
    min_plausible: 1,
    max_plausible: 60,
  },
]

describe('Bioimpedância — recordMeasurementsBatch', () => {
  let tenantId: string
  let patientId: string
  let actorUserId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('bia')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId
    patientId = await seedPatient(tenantId)

    const sb = serviceClient()
    await sb
      .from('patient_metric_types')
      .upsert(
        BIA_METRICS.map((m, i) => ({ ...m, specialty: 'nutricao', display_order: i + 1 })) as never,
        { onConflict: 'metric_type', ignoreDuplicates: true },
      )
      .throwOnError()
  })

  it('grava a sessão inteira com a mesma data', async () => {
    const sb = serviceClient()
    const { measurements } = await recordMeasurementsBatch(sb, {
      tenantId,
      patientId,
      measuredAt: '2026-07-14',
      notes: 'InBody 570',
      entries: [
        { metricType: 'percentual_gordura', value: 22.5 },
        { metricType: 'massa_magra_kg', value: 58 },
        { metricType: 'gordura_visceral', value: 8 },
      ],
      actorUserId,
    })
    expect(measurements).toHaveLength(3)

    const grouped = await listMeasurements(sb, { tenantId, patientId })
    expect(grouped['percentual_gordura']?.[0]?.value).toBe(22.5)
    expect(grouped['massa_magra_kg']?.[0]?.value).toBe(58)
    expect(grouped['gordura_visceral']?.[0]?.value).toBe(8)
    // Mesma data e observação em todas as linhas.
    expect(grouped['percentual_gordura']?.[0]?.measuredAt).toBe('2026-07-14')
    expect(grouped['massa_magra_kg']?.[0]?.notes).toBe('InBody 570')
  })

  it('rejeita a sessão inteira se um valor está fora da faixa (atômico)', async () => {
    const sb = serviceClient()
    const before = await listMeasurements(sb, { tenantId, patientId })
    const countBefore = Object.values(before).flat().length

    await expect(
      recordMeasurementsBatch(sb, {
        tenantId,
        patientId,
        measuredAt: '2026-07-15',
        entries: [
          { metricType: 'massa_magra_kg', value: 60 },
          { metricType: 'percentual_gordura', value: 200 }, // fora de 3–70
        ],
        actorUserId,
      }),
    ).rejects.toThrow(/fora da faixa plausível|MEASUREMENT_OUT_OF_RANGE/)

    const after = await listMeasurements(sb, { tenantId, patientId })
    const countAfter = Object.values(after).flat().length
    // Nada gravado: nem a massa_magra válida entrou.
    expect(countAfter).toBe(countBefore)
  })
})
