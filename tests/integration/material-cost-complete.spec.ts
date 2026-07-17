/**
 * T015 (Feature 045 US1) — completar custo pendente via `set-cost` (auditado)
 * e imutabilidade do snapshot ao editar o catálogo.
 *
 * - Um material lançado sem custo (pendência) é completado por
 *   `setAppointmentMaterialCost` (RPC auditada, `reason` obrigatório).
 * - Editar o custo do insumo no catálogo NÃO altera o snapshot de usos
 *   passados (SC-004).
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
import { setAppointmentMaterialCost } from '@/lib/core/appointments/materials/set-cost'
import { createMaterial, updateMaterial } from '@/lib/core/materials-catalog'

describe('Feature 045 US1 — completar custo + snapshot imutável', () => {
  let tenantId: string
  let actorUserId: string
  let appointmentId: string
  let resinaId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('mat-complete')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    actorUserId = admin.userId

    const sb = serviceClient()
    resinaId = (
      await createMaterial(sb, { tenantId, name: 'Resina', unitCostCents: 1000, actorUserId })
    ).id

    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010049')
    const procedureId = await seedProcedure(tenantId, '00010049')
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
        // Ad-hoc sem custo (pendência).
        { materialName: 'Anestésico', quantity: 1 },
        // Do catálogo com snapshot 1000.
        { materialId: resinaId, materialName: 'Resina', quantity: 2, unitCostCents: 1000 },
      ],
    })
  })

  it('completa o custo pendente e reflete na listagem', async () => {
    const sb = serviceClient()
    const before = await listAppointmentMaterials(sb, { appointmentId, tenantId })
    const pending = before.find((m) => m.name === 'Anestésico')!
    expect(pending.costPending).toBe(true)

    await setAppointmentMaterialCost(sb, {
      tenantId,
      materialRowId: pending.id,
      unitCostCents: 800,
      reason: 'custo informado após conferência',
      actorUserId,
    })

    const after = await listAppointmentMaterials(sb, { appointmentId, tenantId })
    const fixed = after.find((m) => m.id === pending.id)!
    expect(fixed.unitCostCents).toBe(800)
    expect(fixed.totalCostCents).toBe(800)
    expect(fixed.costPending).toBe(false)
  })

  it('editar o custo do insumo no catálogo NÃO altera o snapshot passado', async () => {
    const sb = serviceClient()
    await updateMaterial(sb, {
      tenantId,
      id: resinaId,
      unitCostCents: 5000,
      actorUserId,
    })

    const list = await listAppointmentMaterials(sb, { appointmentId, tenantId })
    const resinaUse = list.find((m) => m.materialId === resinaId)!
    // Snapshot congelado: continua 1000 × 2, não os novos 5000.
    expect(resinaUse.unitCostCents).toBe(1000)
    expect(resinaUse.totalCostCents).toBe(2000)
  })
})
