/**
 * T025 (Feature 045 US2) — "Gasto com materiais" no resultado operacional.
 *
 * - `computeOperatingResult` inclui `materialsCostCents` e o subtrai de
 *   `netProfitCents`; `grossRevenueCents`/`commissionsCents` ficam INALTERADOS
 *   (D1: material desconta só a margem, não toca receita/repasse).
 * - Materiais de atendimento ESTORNADO são excluídos do total.
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
  seedAppointmentProcedure,
} from '@/tests/helpers/seed-factories'
import { attachMaterialsToAppointment } from '@/lib/core/appointments/materials/attach'
import { computeOperatingResult } from '@/lib/core/reports/operating-result'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

describe('Feature 045 US2 — Gasto com materiais no resultado operacional', () => {
  let tenantId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('op-mat')).tenantId
    const admin = await seedUser(tenantId, 'admin')

    const { doctorId, commissionId } = await seedDoctor(tenantId, { bps: 3000 })
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010050')
    const procedureId = await seedProcedure(tenantId, '00010050')
    const pv = await seedPriceVersion({
      tenantId,
      planId,
      procedureId,
      amountCents: 10000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    // Horários fixos no mês corrente, escalonados para não colidir no slot do
    // mesmo médico (EXCLUDE de conflito da feature 005 usa janela de 30 min).
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const at1 = `${ym}-15T12:00:00.000Z`
    const at2 = `${ym}-15T15:00:00.000Z`

    // Atendimento ATIVO (realizado) no mês, com linha de procedimento.
    const apt1 = await seedAppointment({
      tenantId,
      doctorId,
      planId,
      procedureId,
      priceVersionId: pv,
      patientId,
      commissionId,
      amountCents: 10000,
      commissionBps: 3000,
      at: at1,
      completed: true,
    })
    await seedAppointmentProcedure({
      tenantId,
      appointmentId: apt1,
      procedureId,
      planId,
      priceVersionId: pv,
      lineAmountCents: 10000,
    })
    const sb = serviceClient()
    await attachMaterialsToAppointment(sb, {
      appointmentId: apt1,
      tenantId,
      actorUserId: admin.userId,
      materials: [
        { materialName: 'Gaze', quantity: 2, unitCostCents: 500 }, // 1000
        { materialName: 'Sutura', quantity: 1, unitCostCents: 1500 }, // 1500
      ],
    })

    // Atendimento ESTORNADO no mês com material — deve ser EXCLUÍDO.
    const apt2 = await seedAppointment({
      tenantId,
      doctorId,
      planId,
      procedureId,
      priceVersionId: pv,
      patientId,
      commissionId,
      amountCents: 10000,
      commissionBps: 3000,
      at: at2,
    })
    await attachMaterialsToAppointment(sb, {
      appointmentId: apt2,
      tenantId,
      actorUserId: admin.userId,
      materials: [{ materialName: 'Descartado', quantity: 1, unitCostCents: 9999 }],
    })
    await sb
      .from('appointment_reversals')
      .insert({
        id: randomUUID(),
        tenant_id: tenantId,
        appointment_id: apt2,
        reversal_amount_cents: -10000,
        reason: 'teste estorno',
        created_by: admin.userId,
      })
      .throwOnError()
  })

  it('inclui a linha, reduz o lucro e não toca receita/comissão', async () => {
    const sb = serviceClient()
    const result = await computeOperatingResult(sb, { tenantId, month: currentMonth() })

    // D1: receita e comissão vêm só do atendimento ativo, sem influência do material.
    expect(result.lines.grossRevenueCents).toBe(10000)
    expect(result.lines.commissionsCents).toBe(3000)

    // Material do estornado (9999) fica de fora → só 1000 + 1500 = 2500.
    expect(result.lines.materialsCostCents).toBe(2500)

    // Lucro cai exatamente o gasto com materiais (sem fixo/liberal/imposto/despesa).
    expect(result.lines.netProfitCents).toBe(10000 - 3000 - 2500)
    expect(result.drilldowns.materials).toContain('/analise/relatorios/materiais')
  })
})
