/**
 * T059 (Feature 011 — US4) — plano com tax_rate_bps=0 mantém comportamento legado.
 *
 * Convênio sem imposto cadastrado → taxFromPlanCents=0; operatingProfit
 * coincide com o cálculo pré-feature (netRevenue − totalExpenses).
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

const TUSS = '10101098'

describe('Feature 011 — plano sem imposto (bps=0) preserva fórmula legada', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('bps=0 ⇒ taxFromPlanCents=0; lucro = netRevenue − totalExpenses', async () => {
    const { tenantId } = await seedTenant('rep-zero')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'NoTax-Plan')
    const doc = await seedDoctor(tenantId, { crm: 'DOC-ZT', bps: 3000 })
    const pv = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 20000,
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
      amountCents: 20000,
      commissionBps: 3000,
      at: '2026-05-10T10:00:00Z',
    })

    const sb = serviceClient()
    await seedAppointmentLineAndComplete(sb, {
      tenantId,
      appointmentId: aptId,
      procedureId,
      planId,
      priceVersionId: pv,
      amountCents: 20000,
    })
    const report = await buildFinancialReport(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })

    const row = report.revenueByPlan[0]!
    expect(row.taxRateBps).toBe(0)
    expect(row.taxFromPlanCents).toBe(0)
    expect(row.netOfPlanTaxCents).toBe(row.grossRevenueCents)
    expect(report.taxTotals.fromPlansCents).toBe(0)
    expect(report.totals.operatingProfitCents).toBe(
      report.totals.netRevenueCents - report.totals.totalExpensesCents,
    )
  })
})
