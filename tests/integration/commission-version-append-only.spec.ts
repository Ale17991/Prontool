/**
 * T119 — Nova comissão cria nova row em doctor_commission_history; a row
 * anterior permanece intacta; UPDATE/DELETE direto na row antiga via
 * cliente authenticated é bloqueado pelo trigger enforce_append_only().
 * Valida FR-014 + Princípio I da constituição para a tabela.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import { createCommissionVersion } from '@/lib/core/commissions/create-version'

describe('T119 — commission history is append-only', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates a new row per version and leaves older rows untouched', async () => {
    const { tenantId } = await seedTenant('t119')
    const admin = await seedUser(tenantId, 'admin')
    const { doctorId, commissionId } = await seedDoctor(tenantId, { bps: 4000 })
    const sb = serviceClient()

    const v2 = await createCommissionVersion(sb, {
      tenantId,
      doctorId,
      percentageBps: 5000,
      validFrom: '2025-01-01',
      reason: 'reajuste anual',
      actorUserId: admin.userId,
    })
    expect(v2.id).not.toBe(commissionId)

    const { data: rows } = await sb
      .from('doctor_commission_history')
      .select('id, percentage_bps, valid_from, reason')
      .eq('tenant_id', tenantId)
      .eq('doctor_id', doctorId)
      .order('valid_from', { ascending: true })
    expect(rows).toHaveLength(2)
    expect(rows?.[0]).toMatchObject({
      id: commissionId,
      percentage_bps: 4000,
      valid_from: '2020-01-01',
    })
    expect(rows?.[1]).toMatchObject({
      id: v2.id,
      percentage_bps: 5000,
      valid_from: '2025-01-01',
      reason: 'reajuste anual',
    })
  })

  it('UPDATE on an existing commission row via authenticated admin is rejected by the trigger', async () => {
    const { tenantId } = await seedTenant('t119-update')
    const admin = await seedUser(tenantId, 'admin')
    const { commissionId } = await seedDoctor(tenantId, { bps: 4000 })

    const jwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    const sb = rlsClient(jwt)
    const { error } = await sb
      .from('doctor_commission_history')
      .update({ percentage_bps: 9999 })
      .eq('id', commissionId)
    expect(error).not.toBeNull()
    expect(String(error?.message ?? '').toLowerCase()).toMatch(
      /append-only|forbidden|permission|violates|denied/,
    )

    // Confirm row unchanged via service role.
    const svc = serviceClient()
    const { data } = await svc
      .from('doctor_commission_history')
      .select('percentage_bps')
      .eq('id', commissionId)
      .single()
    expect(data?.percentage_bps).toBe(4000)
  })

  it('DELETE on an existing commission row via authenticated admin is rejected', async () => {
    const { tenantId } = await seedTenant('t119-delete')
    const admin = await seedUser(tenantId, 'admin')
    const { commissionId } = await seedDoctor(tenantId, { bps: 4000 })

    const jwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    const sb = rlsClient(jwt)
    const { error } = await sb.from('doctor_commission_history').delete().eq('id', commissionId)
    expect(error).not.toBeNull()

    const svc = serviceClient()
    const { data } = await svc
      .from('doctor_commission_history')
      .select('id')
      .eq('id', commissionId)
      .maybeSingle()
    expect(data?.id).toBe(commissionId)
  })
})
