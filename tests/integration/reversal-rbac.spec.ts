/**
 * T073 — Reversal RBAC.
 *
 * Only `admin` and `financeiro` may call the reversal endpoint.
 * `recepcionista` and `profissional_saude` get 403.
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
const BLOCKED_ROLES = ['recepcionista', 'profissional_saude'] as const

describe('T073 — reversal is gated to admin/financeiro', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it.each(BLOCKED_ROLES)('role=%s receives 403', async (role) => {
    const { tenantId } = await seedTenant(`t073-${role}`)
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
    const user = await seedUser(tenantId, role)
    const jwt = mintJwt({ userId: user.userId, email: user.email, tenantId, role })

    // @ts-expect-error — impl pending T088b

    const { POST } = await import('@/app/api/atendimentos/[id]/reversal/route')
    const res = await POST(
      new Request(`http://localhost/api/atendimentos/${appointmentId}/reversal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ reason: 'test' }),
      }),
      { params: { id: appointmentId } },
    )
    expect(res.status).toBe(403)
  })
})
