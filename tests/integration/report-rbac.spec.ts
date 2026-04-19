/**
 * T135 — Monthly report endpoints are gated to admin and financeiro.
 * recepcionista and profissional_saude get 403 on both the JSON and
 * the export endpoints, with an audit deny recorded.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

const BLOCKED = ['recepcionista', 'profissional_saude'] as const

describe('T135 — monthly report RBAC', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it.each(BLOCKED)('role=%s receives 403 on GET /api/relatorios/mensal and audits denial', async (role) => {
    const { tenantId } = await seedTenant(`t135-json-${role}`)
    const user = await seedUser(tenantId, role)
    const jwt = mintJwt({
      userId: user.userId,
      email: user.email,
      tenantId,
      role,
    })
    const { GET } = await import('@/app/api/relatorios/mensal/route')
    const res = await GET(
      new Request(
        'http://localhost/api/relatorios/mensal?from=2026-05-01&to=2026-05-31',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${jwt}` },
        },
      ),
    )
    expect(res.status).toBe(403)

    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('result, entity, actor_id')
      .eq('tenant_id', tenantId)
      .eq('actor_id', user.userId)
      .eq('result', 'denied')
      .eq('entity', 'reports')
    expect(audit?.length ?? 0).toBeGreaterThan(0)
  })

  it.each(BLOCKED)(
    'role=%s receives 403 on GET /api/relatorios/mensal/export/pdf',
    async (role) => {
      const { tenantId } = await seedTenant(`t135-pdf-${role}`)
      const user = await seedUser(tenantId, role)
      const jwt = mintJwt({
        userId: user.userId,
        email: user.email,
        tenantId,
        role,
      })
      const { GET } = await import('@/app/api/relatorios/mensal/export/[formato]/route')
      const res = await GET(
        new Request(
          'http://localhost/api/relatorios/mensal/export/pdf?from=2026-05-01&to=2026-05-31',
          {
            method: 'GET',
            headers: { authorization: `Bearer ${jwt}` },
          },
        ),
        { params: { formato: 'pdf' } },
      )
      expect(res.status).toBe(403)
    },
  )

  it.each(BLOCKED)(
    'role=%s receives 403 on GET /api/relatorios/mensal/export/excel',
    async (role) => {
      const { tenantId } = await seedTenant(`t135-xlsx-${role}`)
      const user = await seedUser(tenantId, role)
      const jwt = mintJwt({
        userId: user.userId,
        email: user.email,
        tenantId,
        role,
      })
      const { GET } = await import('@/app/api/relatorios/mensal/export/[formato]/route')
      const res = await GET(
        new Request(
          'http://localhost/api/relatorios/mensal/export/excel?from=2026-05-01&to=2026-05-31',
          {
            method: 'GET',
            headers: { authorization: `Bearer ${jwt}` },
          },
        ),
        { params: { formato: 'excel' } },
      )
      expect(res.status).toBe(403)
    },
  )

  it('admin can read the monthly report (200)', async () => {
    const { tenantId } = await seedTenant('t135-admin')
    const admin = await seedUser(tenantId, 'admin')
    const jwt = mintJwt({
      userId: admin.userId,
      email: admin.email,
      tenantId,
      role: 'admin',
    })
    const { GET } = await import('@/app/api/relatorios/mensal/route')
    const res = await GET(
      new Request(
        'http://localhost/api/relatorios/mensal?from=2026-05-01&to=2026-05-31',
        { method: 'GET', headers: { authorization: `Bearer ${jwt}` } },
      ),
    )
    expect(res.status).toBe(200)
  })

  it('financeiro can read the monthly report (200)', async () => {
    const { tenantId } = await seedTenant('t135-fin')
    const fin = await seedUser(tenantId, 'financeiro')
    const jwt = mintJwt({
      userId: fin.userId,
      email: fin.email,
      tenantId,
      role: 'financeiro',
    })
    const { GET } = await import('@/app/api/relatorios/mensal/route')
    const res = await GET(
      new Request(
        'http://localhost/api/relatorios/mensal?from=2026-05-01&to=2026-05-31',
        { method: 'GET', headers: { authorization: `Bearer ${jwt}` } },
      ),
    )
    expect(res.status).toBe(200)
  })
})
