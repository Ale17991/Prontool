/**
 * T008 (Feature 013) — isolamento multi-tenant em
 * `doctor_payment_terms_history`.
 *
 * Constitution Principle III: tenant A NUNCA pode ler payment terms do
 * tenant B. RLS `payment_terms_read_tenant` deve filtrar 100% das leituras.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 013 — payment_terms tenant isolation', () => {
  let tenantA: string
  let tenantB: string
  let adminAjwt: string
  let doctorOfB: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('pt-iso-a')).tenantId
    tenantB = (await seedTenant('pt-iso-b')).tenantId
    const adminA = await seedUser(tenantA, 'admin')
    adminAjwt = mintJwt({
      userId: adminA.userId,
      email: adminA.email,
      tenantId: tenantA,
      role: 'admin',
    })
    const { doctorId } = await seedDoctor(tenantB)
    doctorOfB = doctorId
  })

  it('admin do tenant A NÃO lê payment_terms do tenant B', async () => {
    const rls = rlsClient(adminAjwt)
    const { data, error } = await rls
      .from('doctor_payment_terms_history' as never)
      .select('id, tenant_id, doctor_id')
      .eq('doctor_id', doctorOfB)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('UNIQUE bloqueia mesmo (tenant_id, doctor_id, valid_from)', async () => {
    const sb = serviceClient()
    const { error } = await sb.from('doctor_payment_terms_history' as never).insert({
      tenant_id: tenantB,
      doctor_id: doctorOfB,
      payment_mode: 'comissionado',
      percentage_bps: 5000,
      valid_from: '2020-01-01', // mesma data que a seed
      reason: 'tentativa duplicar',
      created_by: '00000000-0000-0000-0000-000000000000',
    } as never)
    expect(error?.code).toBe('23505') // unique violation
  })
})
