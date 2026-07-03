/**
 * T074a — Patient mutations do not drift existing appointments.
 *
 * Create appointment for patient P. Simulate a second webhook (or direct
 * `upsert-from-ghl` call) that updates P's phone/email. Re-read the
 * appointment: `patient_id` unchanged, `frozen_amount_cents` unchanged, and
 * no `appointments` row mutated. Validates FR-010b — patient identity is
 * stable; billing snapshots never shift because contact data evolved.
 *
 * Red-first: `upsert-from-ghl` (T081) not yet implemented.
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

const TUSS = '10101012'

describe('T074a — patient upsert leaves existing appointments untouched', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('updating patient contact info does not mutate the appointment row', async () => {
    const { tenantId } = await seedTenant('t074a')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 15_000,
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
      amountCents: 15_000,
      commissionBps: 4000,
    })

    const sb = serviceClient()
    const { data: before } = await sb
      .from('appointments')
      .select('id, patient_id, frozen_amount_cents, updated_at')
      .eq('id', appointmentId)
      .single()

    const { upsertPatientFromGhl } = await import('@/lib/core/patients/upsert-from-ghl')
    await upsertPatientFromGhl(sb, {
      tenantId,
      ghlContactId: `contact-${patientId}`,
      fullName: 'Unchanged Name',
      cpf: '00000000000',
      phone: '+5511900000000',
      email: 'new-email@test.local',
      birthDate: '1990-01-01',
    })
    const { piiRegistry } = await import('@/tests/helpers/msw-spies')
    piiRegistry.register(
      'Unchanged Name',
      '00000000000',
      '+5511900000000',
      'new-email@test.local',
      '1990-01-01',
    )

    const { data: after } = await sb
      .from('appointments')
      .select('id, patient_id, frozen_amount_cents, updated_at')
      .eq('id', appointmentId)
      .single()

    expect(after?.patient_id).toBe(before?.patient_id)
    expect(after?.frozen_amount_cents).toBe(before?.frozen_amount_cents)
    expect(after?.updated_at).toBe(before?.updated_at)
  })
})
