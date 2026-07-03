/**
 * Migration 0082 — limite diario de 4 alteracoes de valor (preco e
 * comissao). Substitui o UNIQUE constraint anterior que limitava a 1
 * por dia.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedPriceVersion,
  seedDoctor,
} from '@/tests/helpers/seed-factories'
import { createCommissionVersion } from '@/lib/core/commissions/create-version'
import { createPriceVersion } from '@/lib/core/pricing/create-version'

const TUSS = '10101012'

describe('value change daily limit — migration 0082', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('permite ate 4 versoes de preco no mesmo dia e rejeita a 5a', async () => {
    const { tenantId } = await seedTenant('limit-price')
    const admin = await seedUser(tenantId, 'admin')
    await seedTussCode(TUSS)
    const procedureId = await seedProcedure(tenantId, TUSS)
    const planId = await seedHealthPlan(tenantId, 'Unimode')

    // Seedar 4 versoes no mesmo valid_from via service_role (trigger
    // BEFORE INSERT roda mesmo via service_role e libera ate 4).
    const sb = serviceClient()
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = await seedPriceVersion({
        tenantId,
        procedureId,
        planId,
        amountCents: 10_000 + i * 1_000,
        validFrom: '2026-01-15',
      })
      ids.push(id)
    }
    expect(ids).toHaveLength(4)

    // A 5a tentativa cai no trigger e a RPC mapeia pra
    // PriceVersionConflictError.
    const headId = ids[ids.length - 1]!
    await expect(
      createPriceVersion(sb, {
        tenantId,
        procedureId,
        planId,
        amountCents: 99_999,
        validFrom: '2026-01-15',
        reason: 'quinta tentativa',
        expectedHeadId: headId,
        actorUserId: admin.userId,
      }),
    ).rejects.toThrowError()
  })

  it('permite ate 4 versoes de comissao no mesmo dia e rejeita a 5a', async () => {
    const { tenantId } = await seedTenant('limit-comm')
    const admin = await seedUser(tenantId, 'admin')
    const { doctorId } = await seedDoctor(tenantId, { bps: 4000 })
    // seedDoctor ja insere 1 row em '2020-01-01'. Vamos usar uma data
    // diferente pra controle.
    const sb = serviceClient()

    const VALID = '2026-03-01'
    for (let i = 0; i < 4; i++) {
      await createCommissionVersion(sb, {
        tenantId,
        doctorId,
        percentageBps: 4000 + i * 500,
        validFrom: VALID,
        reason: `mudanca ${i + 1}`,
        actorUserId: admin.userId,
      })
    }

    await expect(
      createCommissionVersion(sb, {
        tenantId,
        doctorId,
        percentageBps: 6000,
        validFrom: VALID,
        reason: 'quinta tentativa',
        actorUserId: admin.userId,
      }),
    ).rejects.toThrow(/COMMISSION_DAILY_LIMIT_EXCEEDED|limite/i)
  })
})
