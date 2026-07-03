/**
 * T102 — Creating a new price version (any vigência) never alters
 * `frozen_amount_cents` on appointments that already exist. Reinforces
 * the schema-level T069 guarantee through the public HTTP layer.
 *
 * Red-first: handler import fails until T112.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedPriceVersion,
  seedDoctor,
  seedPatient,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const TUSS = '10101012'

describe('T102 — new price version leaves existing appointments untouched', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('appointment frozen_amount_cents stays unchanged after admin posts a new price', async () => {
    const { tenantId } = await seedTenant('t102')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const { doctorId, commissionId } = await seedDoctor(tenantId)
    const patientId = await seedPatient(tenantId)
    const v1 = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 22_000,
      validFrom: '2020-01-01',
    })
    const appointmentId = await seedAppointment({
      tenantId,
      patientId,
      doctorId,
      procedureId,
      planId,
      priceVersionId: v1,
      commissionId,
      amountCents: 22_000,
      commissionBps: 4000,
    })

    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const { POST } = await import('@/app/api/precos/versions/route')
    const res = await POST(
      new Request('http://localhost/api/precos/versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          procedure_id: procedureId,
          plan_id: planId,
          amount_cents: 99_000,
          valid_from: '2026-12-01',
          reason: 'reajuste anual',
          expected_head_id: v1,
        }),
      }),
    )
    expect(res.status).toBe(201)

    const sb = serviceClient()
    const { data: appointment } = await sb
      .from('appointments')
      .select('frozen_amount_cents, source_price_version_id')
      .eq('id', appointmentId)
      .single()
    expect(appointment?.frozen_amount_cents).toBe(22_000)
    expect(appointment?.source_price_version_id).toBe(v1)
  })
})
