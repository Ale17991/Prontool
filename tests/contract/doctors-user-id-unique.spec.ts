/**
 * T055 (Feature 012) — UNIQUE parcial doctors_user_id_unique_idx.
 *
 * Bloqueia 2 doctors com mesmo user_id no MESMO tenant.
 * Permite mesmo user_id em tenants diferentes (caso multi-tenant).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedDoctor } from '@/tests/helpers/seed-factories'

describe('Feature 012 — doctors.user_id UNIQUE parcial', () => {
  beforeAll(async () => {
    await resetDatabase()
  })

  it('mesmo tenant: 2 doctors com mesmo user_id → erro 23505', async () => {
    const t = await seedTenant('doc-uniq-a')
    const u = await seedUser(t.tenantId, 'admin')
    const d1 = await seedDoctor(t.tenantId, { crm: 'CRM-D1' })
    const d2 = await seedDoctor(t.tenantId, { crm: 'CRM-D2' })

    const sb = serviceClient()
    const r1 = await sb
      .from('doctors')
      .update({ user_id: u.userId } as never)
      .eq('id', d1.doctorId)
    expect(r1.error).toBeNull()

    const r2 = await sb
      .from('doctors')
      .update({ user_id: u.userId } as never)
      .eq('id', d2.doctorId)
    expect(r2.error).not.toBeNull()
    expect(r2.error?.code).toBe('23505')
  })

  it('tenants diferentes: mesmo user_id permitido', async () => {
    const tA = await seedTenant('doc-uniq-A')
    const tB = await seedTenant('doc-uniq-B')
    const uA = await seedUser(tA.tenantId, 'admin')
    const dA = await seedDoctor(tA.tenantId, { crm: 'CRM-A' })
    const dB = await seedDoctor(tB.tenantId, { crm: 'CRM-B' })

    const sb = serviceClient()
    await sb
      .from('doctors')
      .update({ user_id: uA.userId } as never)
      .eq('id', dA.doctorId)
      .throwOnError()

    // O mesmo user_id em outro tenant — UNIQUE é por (tenant_id, user_id)
    const r = await sb
      .from('doctors')
      .update({ user_id: uA.userId } as never)
      .eq('id', dB.doctorId)
    expect(r.error).toBeNull()
  })
})
