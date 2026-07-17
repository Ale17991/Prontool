/**
 * T014 (Feature 045 US1) — anexar material com custo e listar com
 * `totalCostCents`/`costPending`.
 *
 * Cobre: default do catálogo, override por lançamento, e insumo ad-hoc sem
 * custo (pendência). O custo é snapshot congelado no INSERT.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedDoctor,
  seedAppointment,
  seedHealthPlan,
  seedProcedure,
  seedTussCode,
  seedPriceVersion,
  seedPatient,
} from '@/tests/helpers/seed-factories'
import { attachMaterialsToAppointment } from '@/lib/core/appointments/materials/attach'
import { listAppointmentMaterials } from '@/lib/core/appointments/materials/list'
import { createMaterial } from '@/lib/core/materials-catalog'

describe('Feature 045 US1 — anexar material com custo', () => {
  let tenantId: string
  let actorUserId: string
  let appointmentId: string
  let resinaId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('mat-attach')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId

    const sb = serviceClient()
    const resina = await createMaterial(sb, {
      tenantId,
      name: 'Resina composta',
      unitCostCents: 1200,
      actorUserId,
    })
    resinaId = resina.id

    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010048')
    const procedureId = await seedProcedure(tenantId, '00010048')
    const priceVersionId = await seedPriceVersion({
      tenantId,
      planId,
      procedureId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    appointmentId = await seedAppointment({
      tenantId,
      doctorId,
      planId,
      procedureId,
      priceVersionId,
      patientId,
      commissionId,
      amountCents: 20000,
      commissionBps: 3000,
    })
  })

  it('anexa do catálogo (default), override e ad-hoc sem custo (pendência)', async () => {
    const sb = serviceClient()
    await attachMaterialsToAppointment(sb, {
      appointmentId,
      tenantId,
      actorUserId,
      materials: [
        // Do catálogo, 3× ao custo default (snapshot 1200) → total 3600.
        { materialId: resinaId, materialName: 'Resina composta', quantity: 3, unitCostCents: 1200 },
        // Override do custo naquele lançamento (1500 em vez de 1200).
        { materialId: resinaId, materialName: 'Resina composta', quantity: 1, unitCostCents: 1500 },
        // Ad-hoc sem custo → pendência.
        { materialName: 'Gaze avulsa', quantity: 2 },
      ],
    })

    const list = await listAppointmentMaterials(sb, { appointmentId, tenantId })
    expect(list).toHaveLength(3)

    const doCatalogo = list.find((m) => m.quantity === 3)!
    expect(doCatalogo.unitCostCents).toBe(1200)
    expect(doCatalogo.totalCostCents).toBe(3600)
    expect(doCatalogo.costPending).toBe(false)
    expect(doCatalogo.materialId).toBe(resinaId)

    const override = list.find((m) => m.quantity === 1)!
    expect(override.unitCostCents).toBe(1500)
    expect(override.totalCostCents).toBe(1500)

    const adHoc = list.find((m) => m.name === 'Gaze avulsa')!
    expect(adHoc.unitCostCents).toBe(0)
    expect(adHoc.totalCostCents).toBe(0)
    expect(adHoc.costPending).toBe(true)
    expect(adHoc.materialId).toBeNull()
  })
})
