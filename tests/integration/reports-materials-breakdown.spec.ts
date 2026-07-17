/**
 * T030 (Feature 045 US3) — atribuição do gasto com materiais por
 * profissional (`doctor_id`) e por convênio (`plan_id`).
 *
 * - `materialsCostByDoctor` agrupa por doctor_id.
 * - `materialsCostByPlan` agrupa por plan_id; particular (plan nulo) cai na
 *   chave `MATERIALS_PARTICULAR_KEY`.
 * - Atendimento ESTORNADO é excluído de ambos.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
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
import {
  materialsCostByDoctor,
  materialsCostByPlan,
  MATERIALS_PARTICULAR_KEY,
} from '@/lib/core/reports/materials-cost'

const WINDOW = {
  fromIso: '2020-01-01T00:00:00.000Z',
  toIso: '2999-01-01T00:00:00.000Z',
}

describe('Feature 045 US3 — gasto com materiais por profissional/convênio', () => {
  let tenantId: string
  let doctorA: string
  let doctorB: string
  let planP1: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('mat-breakdown')).tenantId
    const admin = await seedUser(tenantId, 'admin')

    const a = await seedDoctor(tenantId)
    const b = await seedDoctor(tenantId)
    doctorA = a.doctorId
    doctorB = b.doctorId
    planP1 = await seedHealthPlan(tenantId, 'Convênio P1')
    await seedTussCode('00010051')
    const procedureId = await seedProcedure(tenantId, '00010051')
    const pv = await seedPriceVersion({
      tenantId,
      planId: planP1,
      procedureId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    const sb = serviceClient()

    // apt1: doctorA, convênio P1, material 1000. Horários fixos escalonados
    // para não colidir no slot do mesmo médico (EXCLUDE feature 005).
    const apt1 = await seedAppointment({
      tenantId,
      doctorId: doctorA,
      planId: planP1,
      procedureId,
      priceVersionId: pv,
      patientId,
      commissionId: a.commissionId,
      amountCents: 20000,
      commissionBps: 3000,
      at: '2026-06-10T12:00:00.000Z',
    })
    await attachMaterialsToAppointment(sb, {
      appointmentId: apt1,
      tenantId,
      actorUserId: admin.userId,
      materials: [{ materialName: 'Gaze', quantity: 1, unitCostCents: 1000 }],
    })

    // apt2: doctorB, PARTICULAR (plan_id nulo), material 2000.
    const apt2 = randomUUID()
    await sb
      .from('appointments')
      .insert({
        id: apt2,
        tenant_id: tenantId,
        patient_id: patientId,
        doctor_id: doctorB,
        procedure_id: procedureId,
        plan_id: null,
        frozen_amount_cents: 0,
        frozen_commission_bps: 0,
        source_price_version_id: null,
        source_commission_history_id: b.commissionId,
        appointment_at: new Date().toISOString(),
      })
      .throwOnError()
    await attachMaterialsToAppointment(sb, {
      appointmentId: apt2,
      tenantId,
      actorUserId: admin.userId,
      materials: [{ materialName: 'Resina', quantity: 1, unitCostCents: 2000 }],
    })

    // apt3: doctorA, convênio P1, material 5000 — ESTORNADO (excluído).
    const apt3 = await seedAppointment({
      tenantId,
      doctorId: doctorA,
      planId: planP1,
      procedureId,
      priceVersionId: pv,
      patientId,
      commissionId: a.commissionId,
      amountCents: 20000,
      commissionBps: 3000,
      at: '2026-06-10T15:00:00.000Z',
    })
    await attachMaterialsToAppointment(sb, {
      appointmentId: apt3,
      tenantId,
      actorUserId: admin.userId,
      materials: [{ materialName: 'Descartado', quantity: 1, unitCostCents: 5000 }],
    })
    await sb
      .from('appointment_reversals')
      .insert({
        id: randomUUID(),
        tenant_id: tenantId,
        appointment_id: apt3,
        reversal_amount_cents: -20000,
        reason: 'teste estorno',
        created_by: admin.userId,
      })
      .throwOnError()
  })

  it('atribui por profissional e exclui estornado', async () => {
    const sb = serviceClient()
    const byDoctor = await materialsCostByDoctor(sb, { tenantId, ...WINDOW })
    expect(byDoctor.get(doctorA)).toBe(1000) // apt3 (5000) fora
    expect(byDoctor.get(doctorB)).toBe(2000)
  })

  it('atribui por convênio, com particular sob a chave própria', async () => {
    const sb = serviceClient()
    const byPlan = await materialsCostByPlan(sb, { tenantId, ...WINDOW })
    expect(byPlan.get(planP1)).toBe(1000)
    expect(byPlan.get(MATERIALS_PARTICULAR_KEY)).toBe(2000)
  })
})
