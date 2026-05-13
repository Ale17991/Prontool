/**
 * T036 (Feature 012) — RBAC + tenant isolation /api/notificacoes.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

describe('Feature 012 — /api/notificacoes RBAC', () => {
  let tenantId: string
  const users: Record<TenantRole, { jwt: string }> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('notif-rbac')
    tenantId = t.tenantId
    const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']
    for (const role of roles) {
      const u = await seedUser(tenantId, role)
      users[role] = {
        jwt: mintJwt({ userId: u.userId, email: u.email, tenantId, role }),
      }
    }
  })

  const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']
  for (const role of roles) {
    it(`GET /api/notificacoes → 200 para ${role}`, async () => {
      const { GET } = await import('@/app/api/notificacoes/route')
      const res = await GET(
        new Request('http://localhost/api/notificacoes', {
          headers: { authorization: `Bearer ${users[role].jwt}` },
        }),
      )
      expect(res.status).toBe(200)
    })
    it(`GET /api/notificacoes/unread-count → 200 para ${role}`, async () => {
      const { GET } = await import('@/app/api/notificacoes/unread-count/route')
      const res = await GET(
        new Request('http://localhost/api/notificacoes/unread-count', {
          headers: { authorization: `Bearer ${users[role].jwt}` },
        }),
      )
      expect(res.status).toBe(200)
    })
  }
})
