/**
 * T071 — Reversal flow.
 *
 * Create appointment. POST /api/atendimentos/{id}/reversal with role=admin.
 * Assert the `appointments_effective` view reports `effective_status='estornado'`
 * and `net_amount_cents = 0` (original + negative reversal).
 *
 * Red-first: handler import fails until T088b.
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
import { mintJwt } from '@/tests/helpers/jwt-helper'

const TUSS = '10101012'

describe('T071 — reversal flow marks appointment as estornado', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('inserts a negative-amount reversal and appointments_effective reflects it', async () => {
    const { tenantId } = await seedTenant('t071')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 30_000,
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
      amountCents: 30_000,
      commissionBps: 4000,
    })
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })

    const { POST } = await import('@/app/api/atendimentos/[id]/reversal/route')
    const res = await POST(
      new Request(`http://localhost/api/atendimentos/${appointmentId}/reversal`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ reason: 'paciente faltou' }),
      }),
      { params: { id: appointmentId } },
    )
    expect(res.status).toBe(201)

    const sb = serviceClient()
    const { data: effective } = await sb
      .from('appointments_effective')
      .select('effective_status, net_amount_cents')
      .eq('id', appointmentId)
      .single()
    expect(effective?.effective_status).toBe('estornado')
    expect(effective?.net_amount_cents).toBe(0)
  })
})
