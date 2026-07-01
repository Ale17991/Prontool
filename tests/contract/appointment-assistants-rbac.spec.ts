/**
 * T029 (Feature 013) — RBAC em endpoints de assistant em atendimento.
 *
 * POST e PATCH são admin+recepcionista; demais papéis recebem 403.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedDoctor,
  seedAppointment,
  seedHealthPlan,
  seedTussCode,
  seedProcedure,
  seedPriceVersion,
  seedPatient,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 013 — RBAC assistants endpoints', () => {
  let tenantId: string
  let appointmentId: string
  let liberalId: string
  let financeJwt: string
  let recJwt: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('a-rbac')).tenantId
    const admin = await seedUser(tenantId, 'admin')
    const rec = await seedUser(tenantId, 'recepcionista', 'rec')
    const fin = await seedUser(tenantId, 'financeiro', 'fin')
    recJwt = mintJwt({
      userId: rec.userId,
      email: rec.email,
      tenantId,
      role: 'recepcionista',
    })
    financeJwt = mintJwt({
      userId: fin.userId,
      email: fin.email,
      tenantId,
      role: 'financeiro',
    })
    const { doctorId: principal } = await seedDoctor(tenantId)
    const liberal = await seedDoctor(tenantId, { paymentMode: 'liberal' })
    liberalId = liberal.doctorId
    const planId = await seedHealthPlan(tenantId)
    await seedTussCode('00010030')
    const procedureId = await seedProcedure(tenantId, '00010030')
    const pv = await seedPriceVersion({
      tenantId,
      planId,
      procedureId,
      amountCents: 20000,
      validFrom: '2020-01-01',
    })
    const patientId = await seedPatient(tenantId)
    const sb = serviceClient()
    const { data: comm } = await sb
      .from('doctor_commission_history')
      .select('id')
      .eq('doctor_id', principal)
      .single()
    appointmentId = await seedAppointment({
      tenantId,
      doctorId: principal,
      planId,
      procedureId,
      priceVersionId: pv,
      patientId,
      commissionId: (comm as unknown as { id: string }).id,
      amountCents: 20000,
      commissionBps: 3000,
    })
    void admin
  })

  it('financeiro recebe 403 em POST /assistants', async () => {
    const { POST } = await import('@/app/api/atendimentos/[id]/assistants/route')
    const res = await POST(
      new Request(`http://localhost/api/atendimentos/${appointmentId}/assistants`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${financeJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          assistant_doctor_id: liberalId,
          amount_cents: 35000,
        }),
      }),
      { params: { id: appointmentId } },
    )
    expect(res.status).toBe(403)
  })

  it('recepcionista pode POST /assistants e PATCH (remove)', async () => {
    const { POST } = await import('@/app/api/atendimentos/[id]/assistants/route')
    const res = await POST(
      new Request(`http://localhost/api/atendimentos/${appointmentId}/assistants`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${recJwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          assistant_doctor_id: liberalId,
          amount_cents: 35000,
        }),
      }),
      { params: { id: appointmentId } },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBeTruthy()

    const { PATCH } = await import('@/app/api/atendimentos/[id]/assistants/[assistantId]/route')
    const remRes = await PATCH(
      new Request(`http://localhost/api/atendimentos/${appointmentId}/assistants/${body.id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${recJwt}` },
      }),
      { params: { id: appointmentId, assistantId: body.id } },
    )
    expect(remRes.status).toBe(200)
  })
})
