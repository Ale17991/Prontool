/**
 * T050 (Feature 013) — view `monthly_fixed_pay_lines` retorna linha para
 * doctor Fixo apenas A PARTIR do billing_day configurado do mês corrente.
 *
 * Ambientes de CI executam num dia >= 14 do mês — usamos dia 1
 * (sempre antes) e dia 28 (sempre depois) para testar os dois lados.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedDoctor } from '@/tests/helpers/seed-factories'
import { selectMonthlyFixedPayLines } from '@/lib/core/reports/monthly-fixed-pay-lines'

describe('Feature 013 — monthly_fixed_pay_lines view', () => {
  let tenantId: string
  let fixoEarlyId: string
  let fixoLateId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('mfpl')).tenantId
    // Doctor Fixo com billing_day=1 (sempre <= hoje no mês corrente)
    const early = await seedDoctor(tenantId, {
      paymentMode: 'fixo',
      monthlyAmountCents: 800000,
      billingDay: 1,
    })
    fixoEarlyId = early.doctorId
    // Doctor Fixo com billing_day=28 (>= hoje só após dia 28)
    const late = await seedDoctor(tenantId, {
      paymentMode: 'fixo',
      monthlyAmountCents: 1200000,
      billingDay: 28,
    })
    fixoLateId = late.doctorId
  })

  it('Retorna linha do fixo com billing_day passado no mês corrente', async () => {
    const sb = serviceClient()
    const today = new Date()
    const lines = await selectMonthlyFixedPayLines(sb, {
      tenantId,
      year: today.getFullYear(),
      month: today.getMonth() + 1,
    })
    const earlyLine = lines.find((l) => l.doctorId === fixoEarlyId)
    expect(earlyLine).toBeDefined()
    expect(earlyLine!.amountCents).toBe(800000)
    expect(earlyLine!.billingDay).toBe(1)
  })

  it('Linha do fixo com billing_day no futuro NÃO aparece (a menos que hoje >= dia)', async () => {
    const sb = serviceClient()
    const today = new Date()
    const lines = await selectMonthlyFixedPayLines(sb, {
      tenantId,
      year: today.getFullYear(),
      month: today.getMonth() + 1,
    })
    const lateLine = lines.find((l) => l.doctorId === fixoLateId)
    if (today.getDate() < 28) {
      expect(lateLine).toBeUndefined()
    } else {
      expect(lateLine).toBeDefined()
    }
  })

  it('Comissionado e Liberal NÃO aparecem na view', async () => {
    const sb = serviceClient()
    const com = (await seedDoctor(tenantId)).doctorId
    const lib = (await seedDoctor(tenantId, { paymentMode: 'liberal' })).doctorId
    const today = new Date()
    const lines = await selectMonthlyFixedPayLines(sb, {
      tenantId,
      year: today.getFullYear(),
      month: today.getMonth() + 1,
    })
    expect(lines.find((l) => l.doctorId === com)).toBeUndefined()
    expect(lines.find((l) => l.doctorId === lib)).toBeUndefined()
  })
})
