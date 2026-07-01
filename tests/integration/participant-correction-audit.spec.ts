/**
 * T027 (Feature 031, US4) — correção de participação sem perder histórico.
 *
 * Remover (valor errado) + registrar o correto: o repasse passa a usar o novo;
 * a auditoria preserva inclusão e remoção (ator/timestamp/valores).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  setupParticipantScenario,
  type ParticipantScenario,
} from '@/tests/helpers/participants-setup'
import { addParticipant } from '@/lib/core/appointment-assistants/add-participant'
import { removeAssistant } from '@/lib/core/appointment-assistants/remove'
import { getMonthlyPayoutSnapshot } from '@/lib/core/monthly-payouts'

const MONTH = '2026-04'
const AT = '2026-04-12T12:00:00Z'

describe('Feature 031 — correção de participação auditável (US4)', () => {
  let s: ParticipantScenario

  beforeAll(async () => {
    await resetDatabase()
    s = await setupParticipantScenario('p-correcao', { appointmentAt: AT })
  })

  it('remoção + novo registro: repasse usa o novo; auditoria preserva ambos', async () => {
    const sb = serviceClient()
    // 1. valor ERRADO
    const wrong = await addParticipant(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
      procedureId: s.procedureLineId,
      doctorId: s.doctorFixoId,
      participationDegree: '01',
      amountCents: 99999,
      actorUserId: s.adminUserId,
    })
    // 2. remove
    await removeAssistant(sb, {
      tenantId: s.tenantId,
      assistantRowId: wrong.id,
      actorUserId: s.adminUserId,
    })
    // 3. valor CORRETO
    await addParticipant(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
      procedureId: s.procedureLineId,
      doctorId: s.doctorFixoId,
      participationDegree: '01',
      amountCents: 15000,
      actorUserId: s.adminUserId,
    })

    // Repasse (mês aberto) usa apenas o ativo (correto).
    const snap = await getMonthlyPayoutSnapshot(sb, { tenantId: s.tenantId, month: MONTH })
    const fixo = snap.payouts.find((p) => p.doctorId === s.doctorFixoId)!
    expect(fixo.liberalPaymentCents).toBe(15000)

    // Auditoria: ao menos 2 inclusões e 1 remoção registradas.
    const { data: audits, error } = await sb
      .from('audit_log')
      .select('field, entity, new_value')
      .eq('tenant_id', s.tenantId)
      .eq('entity', 'appointment_assistants')
    expect(error).toBeNull()
    const rows = (audits ?? []) as Array<{ field: string; new_value: string | null }>
    const added = rows.filter((r) => r.field === 'added')
    const removed = rows.filter((r) => r.field === 'removed')
    expect(added.length).toBeGreaterThanOrEqual(2)
    expect(removed.length).toBeGreaterThanOrEqual(1)
    // O ator e os valores ficam preservados no payload da auditoria.
    expect(removed[0]!.new_value ?? '').toContain(s.adminUserId)
    expect(added.some((a) => (a.new_value ?? '').includes('99999'))).toBe(true)
    expect(added.some((a) => (a.new_value ?? '').includes('15000'))).toBe(true)
  })
})
