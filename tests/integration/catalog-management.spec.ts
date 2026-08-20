/**
 * T038 (Feature 045 US4) — gestão do catálogo de insumos.
 *
 * - Desativar um insumo o remove do seletor (lista ativa) mas o mantém no
 *   histórico (lista com inativos).
 * - Editar o custo não afeta usos passados (snapshot congelado).
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
import { createMaterial, updateMaterial, listMaterials } from '@/lib/core/materials-catalog'

describe('Feature 045 US4 — gestão do catálogo', () => {
  let tenantId: string
  let actorUserId: string
  let resinaId: string
  let appointmentId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('mat-catalog')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId

    const sb = serviceClient()
    resinaId = (
      await createMaterial(sb, { tenantId, name: 'Resina', unitCostCents: 1000, actorUserId })
    ).id

    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010052')
    const procedureId = await seedProcedure(tenantId, '00010052')
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
    await attachMaterialsToAppointment(sb, {
      appointmentId,
      tenantId,
      actorUserId,
      materials: [
        { materialId: resinaId, materialName: 'Resina', quantity: 2, unitCostCents: 1000 },
      ],
    })
  })

  it('desativar remove do seletor mas mantém no histórico', async () => {
    const sb = serviceClient()
    await updateMaterial(sb, { tenantId, id: resinaId, active: false, actorUserId })

    const active = await listMaterials(sb, { tenantId })
    expect(active.map((m) => m.id)).not.toContain(resinaId)

    const all = await listMaterials(sb, { tenantId, includeInactive: true })
    const found = all.find((m) => m.id === resinaId)!
    expect(found).toBeDefined()
    expect(found.active).toBe(false)
  })

  it('editar custo do catálogo não afeta o snapshot do uso passado', async () => {
    const sb = serviceClient()
    await updateMaterial(sb, { tenantId, id: resinaId, unitCostCents: 3000, actorUserId })

    const list = await listAppointmentMaterials(sb, { appointmentId, tenantId })
    const use = list.find((m) => m.materialId === resinaId)!
    expect(use.unitCostCents).toBe(1000)
    expect(use.totalCostCents).toBe(2000)
  })
})
