/**
 * T072 — Second reversal on the same appointment returns 409.
 *
 * Unique constraint on `appointment_reversals.appointment_id` (T020) enforces
 * single reversal. Handler catches 23505 and maps to 409 Conflict.
 *
 * Red-first: handler import fails until T088b.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
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
import { mintJwt } from '@/tests/helpers/jwt-helper'

const TUSS = '10101012'

describe('T072 — duplicate reversal returns 409', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('first reversal 201, second reversal 409', async () => {
    const { tenantId } = await seedTenant('t072')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 10_000,
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
      amountCents: 10_000,
      commissionBps: 4000,
    })
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    // @ts-expect-error — impl pending T088b

    const { POST } = await import('@/app/api/atendimentos/[id]/reversal/route')
    const request = (): Request =>
      new Request(`http://localhost/api/atendimentos/${appointmentId}/reversal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ reason: 'first' }),
      })

    const first = await POST(request(), { params: { id: appointmentId } })
    expect(first.status).toBe(201)

    const second = await POST(request(), { params: { id: appointmentId } })
    expect(second.status).toBe(409)
  })
})
