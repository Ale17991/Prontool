/**
 * T019 (Feature 031, US2) — o fechamento (close_monthly_payout / 0129) grava o
 * honorário de participação em `liberal_payment_cents` para qualquer modalidade,
 * e o snapshot fechado o reflete.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  setupParticipantScenario,
  type ParticipantScenario,
} from '@/tests/helpers/participants-setup'
import { addParticipant } from '@/lib/core/appointment-assistants/add-participant'
import { closeMonthlyPayout, getMonthlyPayoutSnapshot } from '@/lib/core/monthly-payouts'

const MONTH = '2026-02'
const AT = '2026-02-10T12:00:00Z'

describe('Feature 031 — participações no fechamento do mês', () => {
  let s: ParticipantScenario

  beforeAll(async () => {
    await resetDatabase()
    s = await setupParticipantScenario('p-close', { appointmentAt: AT })
    const sb = serviceClient()
    await addParticipant(sb, {
      tenantId: s.tenantId,
      appointmentId: s.appointmentId,
      procedureId: s.procedureLineId,
      doctorId: s.doctorFixoId,
      participationDegree: '01',
      amountCents: 18000,
      actorUserId: s.adminUserId,
    })
  })

  it('grava liberal_payment_cents no snapshot persistido', async () => {
    const sb = serviceClient()
    const res = await closeMonthlyPayout(sb, { tenantId: s.tenantId, month: MONTH })
    expect(res.payoutsCount).toBeGreaterThan(0)

    const { data, error } = await sb
      .from('monthly_payouts' as never)
      .select('liberal_payment_cents, total_due_cents')
      .eq('tenant_id', s.tenantId)
      .eq('month', MONTH)
      .eq('doctor_id', s.doctorFixoId)
      .single()
    expect(error).toBeNull()
    const row = data as unknown as { liberal_payment_cents: number; total_due_cents: number }
    expect(Number(row.liberal_payment_cents)).toBe(18000)
    expect(Number(row.total_due_cents)).toBe(18000)
  })

  it('snapshot fechado expõe liberalPaymentCents', async () => {
    const sb = serviceClient()
    const snap = await getMonthlyPayoutSnapshot(sb, { tenantId: s.tenantId, month: MONTH })
    expect(snap.isClosed).toBe(true)
    const fixo = snap.payouts.find((p) => p.doctorId === s.doctorFixoId)!
    expect(fixo.liberalPaymentCents).toBe(18000)
  })
})
