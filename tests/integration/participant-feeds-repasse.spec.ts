/**
 * T018 (Feature 031, US2) — honorários de participação entram no repasse do
 * MÊS ABERTO (snapshot ao vivo) para qualquer modalidade; atendimento
 * estornado não conta.
 */
import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  setupParticipantScenario,
  type ParticipantScenario,
} from '@/tests/helpers/participants-setup'
import { addParticipant } from '@/lib/core/appointment-assistants/add-participant'
import { getMonthlyPayoutSnapshot } from '@/lib/core/monthly-payouts'

const MONTH = '2026-03'
const AT = '2026-03-15T12:00:00Z'

describe('Feature 031 — participações alimentam o repasse (mês aberto)', () => {
  let s: ParticipantScenario

  beforeAll(async () => {
    await resetDatabase()
    s = await setupParticipantScenario('p-repasse', { appointmentAt: AT })
    const sb = serviceClient()
    // fixo: 15000 ; comissionado: 22000
    await addParticipant(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
      procedureId: s.procedureLineId,
      doctorId: s.doctorFixoId,
      participationDegree: '01',
      amountCents: 15000,
      actorUserId: s.adminUserId,
    })
    await addParticipant(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
      procedureId: s.procedureLineId,
      doctorId: s.doctorComissionadoId,
      participationDegree: '06',
      amountCents: 22000,
      actorUserId: s.adminUserId,
    })
  })

  it('soma o honorário no liberalPaymentCents de fixo e comissionado', async () => {
    const sb = serviceClient()
    const snap = await getMonthlyPayoutSnapshot(sb, { tenantId: s.tenantId, month: MONTH })
    expect(snap.isClosed).toBe(false)
    const fixo = snap.payouts.find((p) => p.doctorId === s.doctorFixoId)!
    const com = snap.payouts.find((p) => p.doctorId === s.doctorComissionadoId)!
    expect(fixo.liberalPaymentCents).toBe(15000)
    // fixo não tem comissão por atendimento, mas TEM salário fixo (800_000 no
    // seed) — totalDue = salário + honorário liberal.
    expect(fixo.totalDueCents).toBe(815000)
    expect(com.liberalPaymentCents).toBe(22000)
    // comissionado: total inclui honorário + sua eventual comissão
    expect(com.totalDueCents).toBe(com.commissionCents + 22000)
  })

  it('atendimento estornado não contabiliza os honorários', async () => {
    const sb = serviceClient()
    await sb
      .from('appointment_reversals')
      .insert({
        id: randomUUID(),
        tenant_id: s.tenantId,
        appointment_id: s.appointmentId,
        reversal_amount_cents: -20000,
        reason: 'teste US2',
        created_by: s.adminUserId,
      })
      .throwOnError()
    const snap = await getMonthlyPayoutSnapshot(sb, { tenantId: s.tenantId, month: MONTH })
    const fixo = snap.payouts.find((p) => p.doctorId === s.doctorFixoId)!
    const com = snap.payouts.find((p) => p.doctorId === s.doctorComissionadoId)!
    expect(fixo.liberalPaymentCents).toBe(0)
    expect(com.liberalPaymentCents).toBe(0)
  })
})
