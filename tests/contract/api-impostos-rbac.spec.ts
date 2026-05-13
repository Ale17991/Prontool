/**
 * T016 (Feature 011) — RBAC matrix para /api/impostos.
 *
 * Matriz testada:
 *  - GET /api/impostos: admin, financeiro, recepcionista, profissional_saude → 200
 *  - POST /api/impostos: admin/financeiro → 201; recepcionista/profissional_saude → 403
 *  - PATCH /api/impostos/{id}: admin/financeiro → 200; outros → 403
 *
 * Constitution Principle V: papéis devem ser validados server-side antes da execução.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

describe('Feature 011 — RBAC matrix /api/impostos', () => {
  let tenantId: string
  let adminUserId: string
  let seededTaxId: string
  const users: Record<TenantRole, { userId: string; email: string; jwt: string }> =
    {} as never

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('imp-rbac')
    tenantId = t.tenantId

    const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = {
        userId: u.userId,
        email: u.email,
        jwt: mintJwt({ userId: u.userId, email: u.email, tenantId, role }),
      }
    }
    adminUserId = users.admin.userId

    // Seed 1 imposto para teste de GET/PATCH.
    const sb = serviceClient()
    const { data, error } = await sb
      .from('taxes' as never)
      .insert({
        tenant_id: tenantId,
        name: 'ISS-RBAC',
        rate_bps: 500,
        category: 'municipal',
        created_by: adminUserId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed: ${error.message}`)
    seededTaxId = (data as unknown as { id: string }).id
  })

  const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

  for (const role of roles) {
    it(`GET /api/impostos → 200 para ${role}`, async () => {
      const { GET } = await import('@/app/api/impostos/route')
      const res = await GET(
        new Request('http://localhost/api/impostos', {
          headers: { authorization: `Bearer ${users[role].jwt}` },
        }),
      )
      expect(res.status).toBe(200)
    })
  }

  for (const role of roles) {
    const expected = role === 'admin' || role === 'financeiro' ? 201 : 403
    it(`POST /api/impostos → ${expected} para ${role}`, async () => {
      const { POST } = await import('@/app/api/impostos/route')
      const res = await POST(
        new Request('http://localhost/api/impostos', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${users[role].jwt}`,
          },
          body: JSON.stringify({
            name: `ISS-${role}`,
            rate_bps: 500,
            category: 'municipal',
          }),
        }),
      )
      expect(res.status).toBe(expected)
    })
  }

  for (const role of roles) {
    const expected = role === 'admin' || role === 'financeiro' ? 200 : 403
    it(`PATCH /api/impostos/{id} → ${expected} para ${role}`, async () => {
      const { PATCH } = await import('@/app/api/impostos/[id]/route')
      const res = await PATCH(
        new Request(`http://localhost/api/impostos/${seededTaxId}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${users[role].jwt}`,
          },
          body: JSON.stringify({ rate_bps: 600 }),
        }),
        { params: { id: seededTaxId } },
      )
      expect(res.status).toBe(expected)
    })
  }
})
