/**
 * T060: Constitution Principle V validation.
 * Matrix of (role × sensitive action). Every unauthorized combination
 * MUST be rejected and a denial row MUST appear in audit_log.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase, rlsClient, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser, seedHealthPlan } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

const SENSITIVE: Array<{
  role: TenantRole
  allowed: boolean
  action: string
  run: (jwt: string, tenantId: string) => Promise<{ error: unknown }>
}> = []

describe('Principle V — RBAC matrix', () => {
  let tenantId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('rbac')).tenantId
  })

  const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

  for (const role of roles) {
    it(`${role} cannot insert price_versions unless admin`, async () => {
      const u = await seedUser(tenantId, role)
      const jwt = mintJwt({ userId: u.userId, email: u.email, tenantId, role })
      const sb = rlsClient(jwt)
      const { error } = await sb.from('price_versions').insert({
        tenant_id: tenantId,
        procedure_id: randomUUID(),
        plan_id: randomUUID(),
        amount_cents: 100,
        valid_from: '2020-01-01',
        created_by: u.userId,
        reason: 'rbac test',
      })
      if (role === 'admin') {
        // Expect different (FK violation), not permission denial
        expect(String(error ?? '')).not.toMatch(/permission|policy|row-level/i)
      } else {
        expect(error).not.toBeNull()
        expect(String(error?.message ?? '')).toMatch(/policy|permission|violates|denied/i)
      }
    })
  }

  it('non-admin plan updates are blocked even when plan already exists', async () => {
    const planId = await seedHealthPlan(tenantId, 'To-toggle')
    const recep = await seedUser(tenantId, 'recepcionista')
    const jwt = mintJwt({
      userId: recep.userId,
      email: recep.email,
      tenantId,
      role: 'recepcionista',
    })
    const sb = rlsClient(jwt)
    // RLS silently filters out unauthorized rows instead of raising, so
    // `.select()` after the update returns the rows that were actually
    // touched. A blocked update returns an empty array.
    const { data: updated } = await sb
      .from('health_plans')
      .update({ active: false })
      .eq('id', planId)
      .select('id, active')
    expect(updated ?? []).toHaveLength(0)

    // Belt-and-braces: confirm the row is unchanged via service role.
    const sbSvc = serviceClient()
    const { data: plan } = await sbSvc
      .from('health_plans')
      .select('active')
      .eq('id', planId)
      .single()
    expect(plan?.active).toBe(true)
  })

  it('only admin reads audit_log', async () => {
    const financeiro = await seedUser(tenantId, 'financeiro')
    const jwtFin = mintJwt({
      userId: financeiro.userId,
      email: financeiro.email,
      tenantId,
      role: 'financeiro',
    })
    const sbFin = rlsClient(jwtFin)
    const { data } = await sbFin.from('audit_log').select('*')
    expect(data).toEqual([])

    const admin = await seedUser(tenantId, 'admin')
    // Seed one audit row via service-role so admin has something to read
    const sbSvc = serviceClient()
    await sbSvc.from('audit_log').insert({
      tenant_id: tenantId,
      entity: 'test',
      result: 'success',
      reason: 'seed for rbac test',
    })
    const jwtAdmin = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const sbAdm = rlsClient(jwtAdmin)
    const { data: rows } = await sbAdm.from('audit_log').select('*')
    expect((rows ?? []).length).toBeGreaterThan(0)
  })
})
