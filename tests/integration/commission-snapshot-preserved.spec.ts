/**
 * T120 — Public-API variant of T070. Depois que um atendimento é
 * criado, mudar a comissão via `POST /api/medicos/{id}/commission` não
 * altera o `frozen_commission_bps` nem o `source_commission_history_id`
 * do atendimento existente. Valida FR-013/FR-014 ponta a ponta.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedPatient,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const TUSS = '10101012'

describe('T120 — public API: commission change preserves appointment snapshot', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('keeps frozen_commission_bps and source_commission_history_id unchanged after new commission version', async () => {
    const { tenantId } = await seedTenant('t120')
    const admin = await seedUser(tenantId, 'admin')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimed')
    const { doctorId, commissionId } = await seedDoctor(tenantId, { bps: 4000 })
    const priceVersionId = await seedPriceVersion({
      tenantId,
      procedureId,
      planId,
      amountCents: 25_000,
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
      amountCents: 25_000,
      commissionBps: 4000,
    })

    const jwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })

    const { POST } = await import('@/app/api/medicos/[id]/commission/route')
    const res = await POST(
      new Request(`http://localhost/api/medicos/${doctorId}/commission`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          percentage_bps: 6000,
          valid_from: '2027-01-01',
          reason: 'reajuste anual 2027',
        }),
      }),
      { params: { id: doctorId } },
    )
    expect(res.status).toBe(201)

    const sb = serviceClient()
    const { data: appointment } = await sb
      .from('appointments')
      .select('frozen_commission_bps, source_commission_history_id')
      .eq('id', appointmentId)
      .single()
    expect(appointment?.frozen_commission_bps).toBe(4000)
    expect(appointment?.source_commission_history_id).toBe(commissionId)

    // And the commission history now has exactly two rows.
    const { data: history } = await sb
      .from('doctor_commission_history')
      .select('percentage_bps, valid_from')
      .eq('tenant_id', tenantId)
      .eq('doctor_id', doctorId)
      .order('valid_from', { ascending: true })
    expect(history).toEqual([
      { percentage_bps: 4000, valid_from: '2020-01-01' },
      { percentage_bps: 6000, valid_from: '2027-01-01' },
    ])
  })
})
