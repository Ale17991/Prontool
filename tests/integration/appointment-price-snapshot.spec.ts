/**
 * T069 — Appointment freezes price at ingest time.
 *
 * Seed an appointment at frozen_amount A. Afterwards insert a newer
 * `price_versions` row with a bigger `amount_cents`. Re-read the appointment
 * — `frozen_amount_cents` must still equal A. Enforces the append-only,
 * point-in-time invariant of Constitution Principle I + IV.
 *
 * Red-first: no impl required — this exercises schema-level guarantees that
 * already exist in migrations. The test is red now only because
 * `resolvePriceAtNow` helper under src/lib/core/pricing/ is still missing,
 * and because inserting a later price triggers the append-only trigger only
 * for UPDATEs (INSERT of a new row is fine). The assertion is on the
 * unchanged frozen value, which should never move.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetDatabase,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedAppointment,
  seedPatient,
} from '@/tests/helpers/seed-factories'

const TUSS = '10101012'

describe('T069 — appointment price snapshot is preserved across new price versions', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('leaves frozen_amount_cents unchanged when a newer price_versions row is added', async () => {
    const { tenantId } = await seedTenant('t069')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 20_000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    const appointmentId = await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId,
      commissionId,
      amountCents: 20_000,
      commissionBps: 4000,
    })

    // A future price change should NOT back-propagate to the existing row.
    await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 50_000,
      validFrom: '2026-01-01',
    })

    const sb = serviceClient()
    const { data: appointment } = await sb
      .from('appointments')
      .select('frozen_amount_cents, source_price_version_id')
      .eq('id', appointmentId)
      .single()
    expect(appointment?.frozen_amount_cents).toBe(20_000)
    expect(appointment?.source_price_version_id).toBe(priceVersionId)
  })
})
