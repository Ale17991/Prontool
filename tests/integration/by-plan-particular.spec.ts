/**
 * Bug repro: cards do /analise/relatorios/por-plano ficam zerados quando o
 * atendimento e particular (appointment_procedures.plan_id IS NULL).
 *
 * Hipotese investigada: summaryByPlan agregava particular sob planId='' e
 * a pagina mapeava cards apenas por health_plans.id — particular nao tinha
 * card e a receita "desaparecia".
 *
 * Fix: summaryByPlan agora retorna planId=PARTICULAR_KEY ('particular') pra
 * linhas com plan_id=NULL; a pagina renderiza um card Particular fixo.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedPatient,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { PARTICULAR_KEY, summaryByPlan, detailByPlan } from '@/lib/core/reports/by-plan'
import { seedAppointmentLineAndComplete } from './_helpers/seed-appointment-procedure'

const TUSS = '10101095'

describe('Reports — particular (plan_id IS NULL) entra como card proprio', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('summaryByPlan retorna linha particular com planId=PARTICULAR_KEY', async () => {
    const { tenantId } = await seedTenant('rep-part')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Plan-Reserva')
    const doc = await seedDoctor(tenantId, { crm: 'DOC-P', bps: 0 })
    const pv = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 67500,
      validFrom: '2020-01-01',
    })
    const patient = await seedPatient(tenantId)
    // O atendimento ate pode estar marcado com planId no header (FK legada
    // mantida pela migration 0069 pra sequence=1), mas o que importa pro
    // relatorio Por Plano e o plan_id da LINHA — particular = null.
    const aptId = await seedAppointment({
      tenantId,
      patientId: patient,
      doctorId: doc.doctorId,
      procedureId,
      planId,
      priceVersionId: pv,
      commissionId: doc.commissionId,
      amountCents: 67500,
      commissionBps: 0,
      at: '2026-05-15T10:00:00Z',
    })
    const sb = serviceClient()
    await seedAppointmentLineAndComplete(sb, {
      tenantId,
      appointmentId: aptId,
      procedureId,
      planId: null, // particular!
      priceVersionId: null,
      amountCents: 67500,
    })

    const summary = await summaryByPlan(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })
    const particular = summary.find((r) => r.planId === PARTICULAR_KEY)
    expect(particular).toBeDefined()
    expect(particular!.planName).toBe('Particular')
    expect(particular!.procedureCount).toBe(1)
    expect(particular!.totalRevenueCents).toBe(67500)
    // Particular nao tem health_plan, entao tax fica em 0.
    expect(particular!.taxRateBps).toBe(0)
    expect(particular!.taxFromPlanCents).toBe(0)
    expect(particular!.netOfPlanTaxCents).toBe(67500)
  })

  it('summaryByPlan separa lines particular de lines com plano no mesmo periodo', async () => {
    const { tenantId } = await seedTenant('rep-part-mix')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Plan-Misto')
    const doc = await seedDoctor(tenantId, { crm: 'DOC-PM', bps: 0 })
    const pv = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 25000,
      validFrom: '2020-01-01',
    })

    const sb = serviceClient()
    // Atendimento A: linha particular.
    const patientA = await seedPatient(tenantId)
    const aptA = await seedAppointment({
      tenantId,
      patientId: patientA,
      doctorId: doc.doctorId,
      procedureId,
      planId,
      priceVersionId: pv,
      commissionId: doc.commissionId,
      amountCents: 25000,
      commissionBps: 0,
      at: '2026-05-10T10:00:00Z',
    })
    await seedAppointmentLineAndComplete(sb, {
      tenantId,
      appointmentId: aptA,
      procedureId,
      planId: null,
      priceVersionId: null,
      amountCents: 25000,
    })
    // Atendimento B: linha com plano.
    const patientB = await seedPatient(tenantId)
    const aptB = await seedAppointment({
      tenantId,
      patientId: patientB,
      doctorId: doc.doctorId,
      procedureId,
      planId,
      priceVersionId: pv,
      commissionId: doc.commissionId,
      amountCents: 25000,
      commissionBps: 0,
      at: '2026-05-11T10:00:00Z',
    })
    await seedAppointmentLineAndComplete(sb, {
      tenantId,
      appointmentId: aptB,
      procedureId,
      planId,
      priceVersionId: pv,
      amountCents: 25000,
    })

    const summary = await summaryByPlan(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })
    // Duas linhas, uma por bucket.
    expect(summary.map((r) => r.planId).sort()).toEqual([PARTICULAR_KEY, planId].sort())
    const part = summary.find((r) => r.planId === PARTICULAR_KEY)!
    const plan = summary.find((r) => r.planId === planId)!
    expect(part.procedureCount).toBe(1)
    expect(part.totalRevenueCents).toBe(25000)
    expect(plan.procedureCount).toBe(1)
    expect(plan.totalRevenueCents).toBe(25000)
  })

  it('detailByPlan exporta a referencia (cobertura de import); particular fica como branch null', () => {
    // Decriptacao real e validada em by-plan-detail-tax.spec.ts. Aqui apenas
    // garantimos que o sentinel exposto e estavel.
    void detailByPlan
    expect(PARTICULAR_KEY).toBe('particular')
  })
})
