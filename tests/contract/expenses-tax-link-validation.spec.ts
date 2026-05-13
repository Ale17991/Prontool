/**
 * T046 (Feature 011) — tax_id inexistente em POST /api/despesas → 400.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 011 — POST /api/despesas tax_id inválido', () => {
  let adminJwt: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('exp-tax-val')
    const admin = await seedUser(t.tenantId, 'admin')
    adminJwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId: t.tenantId,
      role: 'admin',
    })
  })

  it('tax_id uuid não-existente → 400', async () => {
    const { POST } = await import('@/app/api/despesas/route')
    const res = await POST(
      new Request('http://localhost/api/despesas', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({
          category: 'impostos',
          description: 'test desc',
          amount_cents: 100,
          competence_date: '2026-05-01',
          tax_id: randomUUID(),
        }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('tax_id com formato inválido (não uuid) → 400 (Zod)', async () => {
    const { POST } = await import('@/app/api/despesas/route')
    const res = await POST(
      new Request('http://localhost/api/despesas', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({
          category: 'impostos',
          description: 'test desc',
          amount_cents: 100,
          competence_date: '2026-05-01',
          tax_id: 'not-a-uuid',
        }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
