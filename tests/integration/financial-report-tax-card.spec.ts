/**
 * T061 (Feature 011 — US4) — taxTotals.totalCents = fromPlansCents + fromExpensesCents.
 *
 * Cenário com 1 plano com bps + 1 despesa de imposto. O total
 * consolidado deve cobrir ambos (lado convênio + lado clínica).
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
  seedUser,
} from '@/tests/helpers/seed-factories'
import { buildFinancialReport } from '@/lib/core/reports/financial-report'
import { createTax } from '@/lib/core/taxes/create'
import { createExpense } from '@/lib/core/expenses/create'
import { seedAppointmentLineAndComplete } from './_helpers/seed-appointment-procedure'

const TUSS = '10101096'

describe('Feature 011 — taxTotals consolidado (convênio + clínica)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('soma fromPlansCents + fromExpensesCents === totalCents', async () => {
    const { tenantId } = await seedTenant('rep-card')
    const admin = await seedUser(tenantId, 'admin')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Plan-Card')
    const doc = await seedDoctor(tenantId, { crm: 'DOC-CARD', bps: 3000 })
    const pv = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 50000,
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
      amountCents: 50000,
      commissionBps: 3000,
      at: '2026-05-15T10:00:00Z',
    })

    const sb = serviceClient()
    await sb
      .from('health_plans')
      .update({ tax_rate_bps: 800 } as never)
      .eq('id', planId)
      .throwOnError()
    await seedAppointmentLineAndComplete(sb, {
      tenantId,
      appointmentId: aptId,
      procedureId,
      planId,
      priceVersionId: pv,
      amountCents: 50000,
    })

    // Imposto da clínica: cria tax + despesa vinculada de R$ 200,00
    const tax = await createTax(sb, {
      tenantId,
      name: 'ISS',
      rateBps: 500,
      category: 'municipal',
      actorUserId: admin.userId,
    })
    await createExpense(sb, {
      tenantId,
      category: 'impostos',
      description: 'ISS mai/2026',
      amountCents: 20000,
      competenceDate: '2026-05-20',
      recurring: false,
      actorUserId: admin.userId,
      taxId: tax.id,
    })

    const report = await buildFinancialReport(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })

    expect(report.taxTotals.fromPlansCents).toBe(4000) // 50000 * 800 / 10000
    expect(report.taxTotals.fromExpensesCents).toBe(20000)
    expect(report.taxTotals.totalCents).toBe(24000)
    expect(report.taxTotals.totalCents).toBe(
      report.taxTotals.fromPlansCents + report.taxTotals.fromExpensesCents,
    )
  })
})
