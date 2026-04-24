/**
 * T137 — SC-004: monthly report for 5 000 appointments in a single
 * tenant-month must complete in under 30 s (wall-clock from the
 * aggregator query). We benchmark the domain function directly instead
 * of the HTTP handler to isolate the cost of auth + JSON serialization.
 *
 * Seeding 5 k rows dominates the test's runtime, so we bump the test
 * timeout to 120 s and bulk-insert in 500-row batches.
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
} from '@/tests/helpers/seed-factories'
import { buildMonthlyReport } from '@/lib/core/reports/monthly'

const TUSS = '10101012'
const APPOINTMENT_COUNT = 5_000
const BATCH_SIZE = 500

describe('T137 — monthly report performance at 5 000 appointments', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it(
    'buildMonthlyReport completes under 30 s for 5k appointments',
    async () => {
      const { tenantId } = await seedTenant('t137')
      await seedTussCode(TUSS)
      const procedureId = await seedProcedure(tenantId, TUSS)
      const planId = await seedHealthPlan(tenantId, 'Bulk Plan')
      const { doctorId, commissionId } = await seedDoctor(tenantId, {
        crm: 'DOC-BULK',
        bps: 4000,
      })
      const priceVersionId = await seedPriceVersion({
        tenantId,
        procedureId,
        planId,
        amountCents: 20_000,
        validFrom: '2020-01-01',
      })
      const patientId = await seedPatient(tenantId)

      const sb = serviceClient()
      for (let i = 0; i < APPOINTMENT_COUNT; i += BATCH_SIZE) {
        const batch = Array.from({ length: Math.min(BATCH_SIZE, APPOINTMENT_COUNT - i) }, (_, j) => {
          const minute = (i + j) % 60
          const hour = Math.floor(((i + j) / 60) % 24)
          const day = 1 + Math.floor(((i + j) / (60 * 24)) % 28)
          const dd = String(day).padStart(2, '0')
          const hh = String(hour).padStart(2, '0')
          const mm = String(minute).padStart(2, '0')
          return {
            id: randomUUID(),
            tenant_id: tenantId,
            patient_id: patientId,
            doctor_id: doctorId,
            procedure_id: procedureId,
            plan_id: planId,
            frozen_amount_cents: 20_000,
            frozen_commission_bps: 4000,
            source_price_version_id: priceVersionId,
            source_commission_history_id: commissionId,
            appointment_at: `2026-05-${dd}T${hh}:${mm}:00Z`,
          }
        })
        await sb.from('appointments').insert(batch).throwOnError()
      }

      const started = Date.now()
      const report = await buildMonthlyReport(sb, {
        tenantId,
        from: '2026-05-01',
        to: '2026-05-31',
      })
      const elapsedMs = Date.now() - started

      expect(report.totals.appointmentCount).toBe(APPOINTMENT_COUNT)
      expect(report.totals.netRevenueCents).toBe(APPOINTMENT_COUNT * 20_000)
      expect(report.totals.netCommissionCents).toBe(APPOINTMENT_COUNT * 20_000 * 0.4)
      // eslint-disable-next-line no-console
      console.log(`T137 buildMonthlyReport elapsed: ${elapsedMs} ms for ${APPOINTMENT_COUNT} rows`)
      expect(elapsedMs).toBeLessThan(30_000)
    },
    120_000,
  )
})
