/**
 * T070 — Appointment freezes commission at ingest time.
 *
 * Same pattern as T069 but for `frozen_commission_bps` and
 * `source_commission_history_id`. Validates FR-013, FR-014.
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
  seedAppointment,
  seedPatient,
} from '@/tests/helpers/seed-factories'

const TUSS = '10101012'

describe('T070 — appointment commission snapshot is preserved across new commission history rows', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('leaves frozen_commission_bps unchanged when a newer commission row is added', async () => {
    const { tenantId } = await seedTenant('t070')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const { doctorId, commissionId } = await seedDoctor(tenantId, { bps: 4000 })
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

    const sb = serviceClient()
    const { error } = await sb.from('doctor_commission_history').insert({
      id: randomUUID(),
      tenant_id: tenantId,
      doctor_id: doctorId,
      percentage_bps: 6000,
      valid_from: '2026-01-01',
      reason: 'raise',
    })
    expect(error).toBeNull()

    const { data: appointment } = await sb
      .from('appointments')
      .select('frozen_commission_bps, source_commission_history_id')
      .eq('id', appointmentId)
      .single()
    expect(appointment?.frozen_commission_bps).toBe(4000)
    expect(appointment?.source_commission_history_id).toBe(commissionId)
  })
})
