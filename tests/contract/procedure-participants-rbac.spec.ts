/**
 * T010 (Feature 031) — RBAC nos endpoints de participantes por procedimento.
 *
 * POST e DELETE exigem admin/financeiro; recepcionista e profissional_saude
 * recebem 403 (negação logada por requireRole).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { setupParticipantScenario, type ParticipantScenario } from '@/tests/helpers/participants-setup'
import { seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 031 — RBAC endpoints de participantes', () => {
  let s: ParticipantScenario
  let financeJwt: string
  let recJwt: string
  let profJwt: string

  beforeAll(async () => {
    await resetDatabase()
    s = await setupParticipantScenario('p-rbac')
    const fin = await seedUser(s.tenantId, 'financeiro', 'fin')
    const rec = await seedUser(s.tenantId, 'recepcionista', 'rec')
    const prof = await seedUser(s.tenantId, 'profissional_saude', 'prof')
    financeJwt = mintJwt({ userId: fin.userId, email: fin.email, tenantId: s.tenantId, role: 'financeiro' })
    recJwt = mintJwt({ userId: rec.userId, email: rec.email, tenantId: s.tenantId, role: 'recepcionista' })
    profJwt = mintJwt({ userId: prof.userId, email: prof.email, tenantId: s.tenantId, role: 'profissional_saude' })
  })

  async function postAs(jwt: string): Promise<Response> {
    const { POST } = await import('@/app/api/atendimentos/[id]/participantes/route')
    return POST(
      new Request(`http://localhost/api/atendimentos/${s.appointmentId}/participantes`, {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          procedureId: s.procedureLineId,
          doctorId: s.doctorFixoId,
          participationDegree: '01',
          amountCents: 15000,
        }),
      }),
      { params: { id: s.appointmentId } },
    )
  }

  it('recepcionista recebe 403 em POST', async () => {
    expect((await postAs(recJwt)).status).toBe(403)
  })

  it('profissional_saude recebe 403 em POST', async () => {
    expect((await postAs(profJwt)).status).toBe(403)
  })

  it('financeiro pode POST e DELETE', async () => {
    const res = await postAs(financeJwt)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { participantId: string }
    expect(body.participantId).toBeTruthy()

    const { DELETE } = await import('@/app/api/atendimentos/[id]/participantes/[participantId]/route')
    const del = await DELETE(
      new Request(
        `http://localhost/api/atendimentos/${s.appointmentId}/participantes/${body.participantId}`,
        { method: 'DELETE', headers: { authorization: `Bearer ${financeJwt}` } },
      ),
      { params: { id: s.appointmentId, participantId: body.participantId } },
    )
    expect(del.status).toBe(200)
  })

  it('recepcionista recebe 403 em DELETE', async () => {
    // cria via service para garantir alvo
    const sb = serviceClient()
    const { data, error } = await sb.rpc('attach_assistant_to_appointment', {
      p_appointment_id: s.appointmentId,
      p_assistant_doctor_id: s.doctorLiberalId,
      p_amount_cents: 9000,
      p_actor: s.adminUserId,
      p_procedure_id: s.procedureLineId,
      p_participation_degree: '00',
    } as never)
    if (error) throw new Error(error.message)
    const pid = data as unknown as string
    const { DELETE } = await import('@/app/api/atendimentos/[id]/participantes/[participantId]/route')
    const del = await DELETE(
      new Request(`http://localhost/api/atendimentos/${s.appointmentId}/participantes/${pid}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${recJwt}` },
      }),
      { params: { id: s.appointmentId, participantId: pid } },
    )
    expect(del.status).toBe(403)
  })
})
