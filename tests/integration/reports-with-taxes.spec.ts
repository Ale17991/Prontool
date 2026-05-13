/**
 * T058 (Feature 011 — US4) — buildFinancialReport aplica tax_rate_bps por plano.
 *
 * Cenário: 1 plano com bps=650, 1 atendimento bruto R$ 100,00 →
 *   taxFromPlanCents = round(10000 * 650 / 10000) = 650
 *   netOfPlanTaxCents = 10000 - 650 = 9350
 *   taxTotals.fromPlansCents = 650
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
import { buildFinancialReport } from '@/lib/core/reports/financial-report'
import { seedAppointmentLineAndComplete } from './_helpers/seed-appointment-procedure'

const TUSS = '10101099'

describe('Feature 011 — buildFinancialReport com tax_rate_bps', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('plano bps=650 + bruto 10000 cents → taxFromPlanCents=650', async () => {
    const { tenantId } = await seedTenant('rep-tax-1')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed-Tax')
    const doc = await seedDoctor(tenantId, { crm: 'DOC-RT', bps: 3000 })
    const pv = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 10000,
      validFrom: '2020-01-01',
    })
    const patient = await seedPatient(tenantId)
    const aptId = await seedAppointment({
      tenantId,
      patientId: patient,
      doctorId: doc.doctorId,
      procedureId,
      planId,
      priceVersionId: pv,
      commissionId: doc.commissionId,
      amountCents: 10000,
      commissionBps: 3000,
      at: '2026-05-10T10:00:00Z',
    })

    const sb = serviceClient()
    await sb
      .from('health_plans')
      .update({ tax_rate_bps: 650 } as never)
      .eq('id', planId)
      .throwOnError()
    await seedAppointmentLineAndComplete(sb, {
      tenantId,
      appointmentId: aptId,
      procedureId,
      planId,
      priceVersionId: pv,
      amountCents: 10000,
    })

    const report = await buildFinancialReport(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })

    const row = report.revenueByPlan.find((r) => r.planId === planId)
    expect(row).toBeDefined()
    expect(row!.grossRevenueCents).toBe(10000)
    expect(row!.taxRateBps).toBe(650)
    expect(row!.taxFromPlanCents).toBe(650)
    expect(row!.netOfPlanTaxCents).toBe(9350)
    expect(report.taxTotals.fromPlansCents).toBe(650)
    expect(report.taxTotals.fromExpensesCents).toBe(0)
    expect(report.taxTotals.totalCents).toBe(650)
  })
})
