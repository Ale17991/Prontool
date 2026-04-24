/**
 * T133 — Monthly report totals are stable: inserting a newer price
 * version with a future vigência must not change the totals for any
 * past period, because the view uses `frozen_amount_cents` (FR-012).
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
} from '@/tests/helpers/seed-factories'
import { buildMonthlyReport } from '@/lib/core/reports/monthly'

const TUSS = '10101012'

describe('T133 — monthly report is immutable under future price changes', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('totals unchanged after inserting a newer price version with future valid_from', async () => {
    const { tenantId } = await seedTenant('t133')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const { doctorId, commissionId } = await seedDoctor(tenantId, { bps: 4000 })
    const pv1 = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 100_000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId: pv1,
      commissionId,
      amountCents: 100_000,
      commissionBps: 4000,
      at: '2026-05-10T10:00:00Z',
    })

    const sb = serviceClient()
    const before = await buildMonthlyReport(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })
    expect(before.totals.netRevenueCents).toBe(100_000)
    expect(before.totals.netCommissionCents).toBe(40_000)

    // Append a future price version (and a future commission) — nothing past.
    await sb
      .from('price_versions')
      .insert({
        id: randomUUID(),
        tenant_id: tenantId,
        procedure_id: procedureId,
        plan_id: planId,
        amount_cents: 500_000,
        valid_from: '2027-01-01',
        previous_version_id: pv1,
        created_by: randomUUID(),
        reason: 'reajuste futuro',
      })
      .throwOnError()
    await sb
      .from('doctor_commission_history')
      .insert({
        id: randomUUID(),
        tenant_id: tenantId,
        doctor_id: doctorId,
        percentage_bps: 9000,
        valid_from: '2027-01-01',
        reason: 'reajuste futuro',
      })
      .throwOnError()

    const after = await buildMonthlyReport(sb, {
      tenantId,
      from: '2026-05-01',
      to: '2026-05-31',
    })
    expect(after.totals).toEqual(before.totals)
    expect(after.revenueByPlan).toEqual(before.revenueByPlan)
    expect(after.productionByDoctor).toEqual(before.productionByDoctor)
  })
})
