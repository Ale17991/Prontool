/**
 * T132 — Monthly report aggregation produces numbers matching a
 * hand-calculated 2×2 matrix (two plans × two doctors) with one
 * reversal. Verifies revenue_by_plan, production_by_doctor, and totals.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
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
  seedAppointmentCompletion,
} from '@/tests/helpers/seed-factories'
import { buildMonthlyReport } from '@/lib/core/reports/monthly'

const TUSS = '10101012'

describe('T132 — monthly report aggregation', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('aggregates revenue/production across 2 plans × 2 doctors with one reversal', async () => {
    const { tenantId } = await seedTenant('t132')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planA = await seedHealthPlan(tenantId, 'Plan A')
    const planB = await seedHealthPlan(tenantId, 'Plan B')
    const docA = await seedDoctor(tenantId, { crm: 'DOC-A', bps: 4000 })
    const docB = await seedDoctor(tenantId, { crm: 'DOC-B', bps: 3000 })

    const pvA = await seedPriceVersion({
      tenantId,
      procedureId,
      planId: planA,
      amountCents: 100_000,
      validFrom: '2020-01-01',
    })
    const pvB = await seedPriceVersion({
      tenantId,
      procedureId,
      planId: planB,
      amountCents: 200_000,
      validFrom: '2020-01-01',
    })

    const patientId = await seedPatient(tenantId)

    // apt1: docA / planA / 100_000 — active
    const apt1 = await seedAppointment({
      tenantId,
      patientId,
      doctorId: docA.doctorId,
      procedureId,
      planId: planA,
      priceVersionId: pvA,
      commissionId: docA.commissionId,
      amountCents: 100_000,
      commissionBps: 4000,
      at: '2026-05-05T10:00:00Z',
    })
    // apt2: docA / planB / 200_000 — active
    const apt2 = await seedAppointment({
      tenantId,
      patientId,
      doctorId: docA.doctorId,
      procedureId,
      planId: planB,
      priceVersionId: pvB,
      commissionId: docA.commissionId,
      amountCents: 200_000,
      commissionBps: 4000,
      at: '2026-05-12T10:00:00Z',
    })
    // apt3: docB / planA / 50_000 — REVERSED
    const apt3 = await seedAppointment({
      tenantId,
      patientId,
      doctorId: docB.doctorId,
      procedureId,
      planId: planA,
      priceVersionId: pvA,
      commissionId: docB.commissionId,
      amountCents: 50_000,
      commissionBps: 3000,
      at: '2026-05-18T10:00:00Z',
    })
    // apt4: docB / planB / 150_000 — active
    const apt4 = await seedAppointment({
      tenantId,
      patientId,
      doctorId: docB.doctorId,
      procedureId,
      planId: planB,
      priceVersionId: pvB,
      commissionId: docB.commissionId,
      amountCents: 150_000,
      commissionBps: 3000,
      at: '2026-05-22T10:00:00Z',
    })

    // Só atendimentos REALIZADOS ('ativo') entram na receita/contagem — a view
    // vira 'ativo' quando há appointment_completions. apt3 é estornado (reversal
    // tem precedência no CASE), então não é completado.
    await seedAppointmentCompletion({ tenantId, appointmentId: apt1 })
    await seedAppointmentCompletion({ tenantId, appointmentId: apt2 })
    await seedAppointmentCompletion({ tenantId, appointmentId: apt4 })

    // Reversal on apt3
    const sb = serviceClient()
    await sb
      .from('appointment_reversals')
      .insert({
        id: randomUUID(),
        tenant_id: tenantId,
        appointment_id: apt3,
        reversal_amount_cents: -50_000,
        reason: 'teste',
        created_by: randomUUID(),
      })
      .throwOnError()

    // Appointment outside the period should not show up.
    await seedAppointment({
      tenantId,
      patientId,
      doctorId: docA.doctorId,
      procedureId,
      planId: planA,
      priceVersionId: pvA,
      commissionId: docA.commissionId,
      amountCents: 999_000,
      commissionBps: 4000,
      at: '2026-06-02T10:00:00Z',
    })

    const report = await buildMonthlyReport(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })

    // Totals: 100_000 + 200_000 + 0 (reversed) + 150_000 = 450_000
    expect(report.totals.netRevenueCents).toBe(450_000)
    // Commission: docA net = 300_000 @ 40% = 120_000; docB net = 150_000 @ 30% = 45_000
    expect(report.totals.netCommissionCents).toBe(165_000)
    // totals.appointmentCount conta TODOS os atendimentos do período (inclui o
    // estornado); receita e counts por-plano/médico contam só 'ativo'.
    expect(report.totals.appointmentCount).toBe(4)
    expect(report.totals.reversalCount).toBe(1)

    const planAAgg = report.revenueByPlan.find((r) => r.planId === planA)
    const planBAgg = report.revenueByPlan.find((r) => r.planId === planB)
    // planA: apt1 (100_000) ativo; apt3 estornado não conta = 100_000, count 1
    expect(planAAgg).toMatchObject({
      planName: 'Plan A',
      netRevenueCents: 100_000,
      appointmentCount: 1,
    })
    // planB: apt2 (200_000) + apt4 (150_000) = 350_000, count 2
    expect(planBAgg).toMatchObject({
      planName: 'Plan B',
      netRevenueCents: 350_000,
      appointmentCount: 2,
    })

    const docAAgg = report.productionByDoctor.find((d) => d.doctorId === docA.doctorId)
    const docBAgg = report.productionByDoctor.find((d) => d.doctorId === docB.doctorId)
    expect(docAAgg).toMatchObject({
      netProductionCents: 300_000,
      netCommissionCents: 120_000,
      appointmentCount: 2,
    })
    expect(docBAgg).toMatchObject({
      netProductionCents: 150_000,
      netCommissionCents: 45_000,
      appointmentCount: 1,
    })

    // Belt-and-suspenders: referenced appointment IDs all exist in the view.
    const { data: viewRows } = await sb
      .from('appointments_effective')
      .select('id, effective_status, net_amount_cents, net_commission_cents')
      .eq('tenant_id', tenantId)
      .in('id', [apt1, apt2, apt3, apt4])
    expect(viewRows ?? []).toHaveLength(4)
    const reversed = viewRows?.find((r) => r.id === apt3)
    expect(reversed?.effective_status).toBe('estornado')
    expect(reversed?.net_amount_cents).toBe(0)
    expect(reversed?.net_commission_cents).toBe(0)
  })
})
