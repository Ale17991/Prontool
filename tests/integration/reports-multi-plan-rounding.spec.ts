/**
 * T060 (Feature 011 — US4) — soma dos arredondamentos por plano coincide com totalCents.
 *
 * 3 planos com bps distintos sobre 33333 cents cada (valor escolhido por
 * gerar fração no cálculo). Verifica que sum(taxFromPlanCents) ===
 * taxTotals.fromPlansCents (sem perda em agregação).
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

const TUSS = '10101097'

describe('Feature 011 — multi-plano com bps distintos, soma === total', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('3 planos × bps distintos × 33333 cents', async () => {
    const { tenantId } = await seedTenant('rep-round')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const doc = await seedDoctor(tenantId, { crm: 'DOC-RD', bps: 3000 })
    const patient = await seedPatient(tenantId)

    const sb = serviceClient()
    const plans: Array<{ id: string; bps: number }> = []
    const bpsSet = [333, 654, 1250]
    // Cada atendimento em horário diferente para evitar APPOINTMENT_CONFLICT
    // do trigger appointment_slot_locks (mesma doutora, mesmo horário, blocked).
    const times = ['2026-05-10T10:00:00Z', '2026-05-10T11:00:00Z', '2026-05-10T12:00:00Z']
    let i = 0
    for (const bps of bpsSet) {
      const planId = await seedHealthPlan(tenantId, `Plan-${i}`)
      const pv = await seedPriceVersion({
        tenantId,
        procedureId,
        planId,
        amountCents: 33333,
        validFrom: '2020-01-01',
      })
      const aptId = await seedAppointment({
        tenantId,
        patientId: patient,
        doctorId: doc.doctorId,
        procedureId,
        planId,
        priceVersionId: pv,
        commissionId: doc.commissionId,
        amountCents: 33333,
        commissionBps: 3000,
        at: times[i++]!,
      })
      await sb
        .from('health_plans')
        .update({ tax_rate_bps: bps } as never)
        .eq('id', planId)
        .throwOnError()
      await seedAppointmentLineAndComplete(sb, {
        tenantId,
        appointmentId: aptId,
        procedureId,
        planId,
        priceVersionId: pv,
        amountCents: 33333,
      })
      plans.push({ id: planId, bps })
    }

    const report = await buildFinancialReport(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })

    expect(report.revenueByPlan).toHaveLength(3)
    const sum = report.revenueByPlan.reduce((acc, r) => acc + r.taxFromPlanCents, 0)
    expect(sum).toBe(report.taxTotals.fromPlansCents)

    // Cada plano tem o arredondamento half-away-from-zero esperado.
    for (const r of report.revenueByPlan) {
      const expected = Math.round((r.grossRevenueCents * r.taxRateBps) / 10000)
      expect(r.taxFromPlanCents).toBe(expected)
    }
  })
})
