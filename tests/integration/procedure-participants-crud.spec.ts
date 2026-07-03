/**
 * T011 (Feature 031) — CRUD de participantes por procedimento.
 *
 * Cobre: 2 participantes de modalidades distintas (fixo + comissionado) num
 * mesmo procedimento (aceitos — qualquer modalidade); duplicado bloqueado;
 * remoção soft-unlink; grau fora do domínio 35 rejeitado; honorário ≤ 0
 * rejeitado.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  setupParticipantScenario,
  type ParticipantScenario,
} from '@/tests/helpers/participants-setup'
import { addParticipant } from '@/lib/core/appointment-assistants/add-participant'
import { removeAssistant } from '@/lib/core/appointment-assistants/remove'
import {
  listParticipantsByProcedure,
  groupParticipantsByProcedure,
} from '@/lib/core/appointment-assistants/list-participants-by-procedure'
import { ConflictError, DomainError, ValidationError } from '@/lib/observability/errors'

describe('Feature 031 — participantes por procedimento (CRUD)', () => {
  let s: ParticipantScenario

  beforeAll(async () => {
    await resetDatabase()
    s = await setupParticipantScenario('p-crud')
  })

  it('aceita 2 participantes de modalidades distintas (fixo + comissionado)', async () => {
    const sb = serviceClient()
    const r1 = await addParticipant(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
      procedureId: s.procedureLineId,
      doctorId: s.doctorFixoId,
      participationDegree: '01',
      amountCents: 15000,
      actorUserId: s.adminUserId,
    })
    const r2 = await addParticipant(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
      procedureId: s.procedureLineId,
      doctorId: s.doctorComissionadoId,
      participationDegree: '06',
      amountCents: 22000,
      actorUserId: s.adminUserId,
    })
    expect(r1.id).toBeTruthy()
    expect(r2.id).toBeTruthy()

    const list = await listParticipantsByProcedure(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
    })
    const byProc = groupParticipantsByProcedure(list)
    const onLine = byProc.get(s.procedureLineId) ?? []
    expect(onLine).toHaveLength(2)
    const anesthetist = onLine.find((p) => p.participationDegree === '06')
    expect(anesthetist?.degreeLabel).toBe('Anestesista')
    expect(anesthetist?.amountCents).toBe(22000)
  })

  it('bloqueia o mesmo profissional duplicado no mesmo procedimento', async () => {
    const sb = serviceClient()
    await expect(
      addParticipant(sb, {
        tenantId: s.tenantId,
        appointmentId: s.appointmentId,
        procedureId: s.procedureLineId,
        doctorId: s.doctorFixoId, // já adicionado acima
        participationDegree: '00',
        amountCents: 10000,
        actorUserId: s.adminUserId,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('remoção soft-unlink tira da lista ativa mantendo histórico', async () => {
    const sb = serviceClient()
    const before = await listParticipantsByProcedure(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
    })
    const target = before.find((p) => p.doctorId === s.doctorFixoId)!
    await removeAssistant(sb, {
      tenantId: s.tenantId,
      assistantRowId: target.participantId,
      actorUserId: s.adminUserId,
    })
    const after = await listParticipantsByProcedure(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
    })
    expect(after.find((p) => p.participantId === target.participantId)).toBeUndefined()
    // O registro histórico continua na tabela (removed_at set).
    const { data } = await sb
      .from('appointment_assistants' as never)
      .select('removed_at')
      .eq('id', target.participantId)
      .single()
    expect((data as unknown as { removed_at: string | null }).removed_at).not.toBeNull()
  })

  it('rejeita grau fora do domínio 35', async () => {
    const sb = serviceClient()
    await expect(
      addParticipant(sb, {
        tenantId: s.tenantId,
        appointmentId: s.appointmentId,
        procedureId: s.procedureLineId,
        doctorId: s.doctorLiberalId,
        participationDegree: 'ZZ',
        amountCents: 10000,
        actorUserId: s.adminUserId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DEGREE' })
  })

  it('rejeita honorário ≤ 0', async () => {
    const sb = serviceClient()
    await expect(
      addParticipant(sb, {
        tenantId: s.tenantId,
        appointmentId: s.appointmentId,
        procedureId: s.procedureLineId,
        doctorId: s.doctorLiberalId,
        participationDegree: '00',
        amountCents: 0,
        actorUserId: s.adminUserId,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('re-adicionar o mesmo médico após remoção é permitido (correção)', async () => {
    const sb = serviceClient()
    const r = await addParticipant(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
      procedureId: s.procedureLineId,
      doctorId: s.doctorFixoId, // removido no teste anterior
      participationDegree: '01',
      amountCents: 18000,
      actorUserId: s.adminUserId,
    })
    expect(r.id).toBeTruthy()
    // sanity: o DomainError não vazou
    void DomainError
  })
})
