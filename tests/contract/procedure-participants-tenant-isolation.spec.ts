/**
 * T009 (Feature 031) — isolamento multi-tenant das participações.
 *
 * Cobre: participante de outro tenant barrado; procedimento de outro tenant
 * barrado (trigger de consistência); leitura de participação de A negada ao
 * tenant B (RLS).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  setupParticipantScenario,
  type ParticipantScenario,
} from '@/tests/helpers/participants-setup'
import { addParticipant } from '@/lib/core/appointment-assistants/add-participant'

describe('Feature 031 — participantes tenant isolation', () => {
  let a: ParticipantScenario
  let b: ParticipantScenario

  beforeAll(async () => {
    await resetDatabase()
    a = await setupParticipantScenario('p-iso-a')
    b = await setupParticipantScenario('p-iso-b')
  })

  it('participante (médico) de outro tenant é barrado', async () => {
    const sb = serviceClient()
    await expect(
      addParticipant(sb, {
        tenantId: a.tenantId,
        appointmentId: a.appointmentId,
        procedureId: a.procedureLineId,
        doctorId: b.doctorComissionadoId, // médico do tenant B
        participationDegree: '00',
        amountCents: 10000,
        actorUserId: a.adminUserId,
      }),
    ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' })
  })

  it('procedimento de outro tenant é barrado', async () => {
    const sb = serviceClient()
    await expect(
      addParticipant(sb, {
        tenantId: a.tenantId,
        appointmentId: a.appointmentId,
        procedureId: b.procedureLineId, // linha do tenant B
        doctorId: a.doctorComissionadoId,
        participationDegree: '00',
        amountCents: 10000,
        actorUserId: a.adminUserId,
      }),
    ).rejects.toMatchObject({ code: 'PROCEDURE_NOT_FOUND' })
  })

  it('tenant B não lê participação criada no tenant A (RLS)', async () => {
    const sb = serviceClient()
    const r = await addParticipant(sb, {
      tenantId: a.tenantId,
      appointmentId: a.appointmentId,
      procedureId: a.procedureLineId,
      doctorId: a.doctorComissionadoId,
      participationDegree: '00',
      amountCents: 12000,
      actorUserId: a.adminUserId,
    })
    const rlsB = rlsClient(b.adminJwt)
    const { data } = await rlsB
      .from('appointment_assistants' as never)
      .select('id')
      .eq('id', r.id)
      .maybeSingle()
    expect(data).toBeNull()
  })
})
