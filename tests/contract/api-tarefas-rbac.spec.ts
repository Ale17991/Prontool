/**
 * T020 (Feature 012) — RBAC matrix /api/tarefas.
 *
 * - GET: 4 papéis autenticados podem acessar (RLS filtra escopo).
 * - POST: 4 papéis; não-admin tem assigned_to forçado para si.
 * - PATCH: 4 papéis; soft_delete só admin.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import type { TenantRole } from '@/lib/db/types'

describe('Feature 012 — RBAC /api/tarefas', () => {
  let tenantId: string
  let adminUserId: string
  let recepUserId: string
  let seededTaskId: string
  const users: Record<TenantRole, { userId: string; email: string; jwt: string }> = {} as never

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('tarefas-rbac')
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
    recepUserId = users.recepcionista.userId

    // Seed tarefa atribuída à recepcionista para testes de PATCH.
    const sb = serviceClient()
    const { data, error } = await sb
      .from('tasks' as never)
      .insert({
        tenant_id: tenantId,
        title: 'tarefa RBAC',
        due_date: '2026-12-31',
        assigned_to: recepUserId,
        assigned_by: adminUserId,
        priority: 'normal',
        created_by: adminUserId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed: ${error.message}`)
    seededTaskId = (data as unknown as { id: string }).id
  })

  const roles: TenantRole[] = ['admin', 'financeiro', 'recepcionista', 'profissional_saude']

  for (const role of roles) {
    it(`GET /api/tarefas → 200 para ${role}`, async () => {
      const { GET } = await import('@/app/api/tarefas/route')
      const res = await GET(
        new Request('http://localhost/api/tarefas', {
          headers: { authorization: `Bearer ${users[role].jwt}` },
        }),
      )
      expect(res.status).toBe(200)
    })
  }

  it('admin POST com assigned_to=outroUsuario → 201', async () => {
    const { POST } = await import('@/app/api/tarefas/route')
    const res = await POST(
      new Request('http://localhost/api/tarefas', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${users.admin.jwt}`,
        },
        body: JSON.stringify({
          title: 'Admin cria para outro',
          due_date: '2026-12-31',
          assigned_to: recepUserId,
          priority: 'alta',
        }),
      }),
    )
    expect(res.status).toBe(201)
  })

  it('recepcionista POST com assigned_to=admin → server FORÇA para self', async () => {
    const { POST } = await import('@/app/api/tarefas/route')
    const res = await POST(
      new Request('http://localhost/api/tarefas', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${users.recepcionista.jwt}`,
        },
        body: JSON.stringify({
          title: 'Tenta atribuir para admin',
          due_date: '2026-12-31',
          assigned_to: adminUserId, // server vai sobrescrever
          priority: 'normal',
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { assigned_to: string }
    expect(body.assigned_to).toBe(recepUserId)
  })

  it('financeiro PATCH soft_delete → 403 (só admin)', async () => {
    const { PATCH } = await import('@/app/api/tarefas/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/tarefas/${seededTaskId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${users.financeiro.jwt}`,
        },
        body: JSON.stringify({ soft_delete: true }),
      }),
      { params: { id: seededTaskId } },
    )
    expect(res.status).toBe(403)
  })

  it('admin PATCH soft_delete → 200', async () => {
    const { PATCH } = await import('@/app/api/tarefas/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/tarefas/${seededTaskId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${users.admin.jwt}`,
        },
        body: JSON.stringify({ soft_delete: true }),
      }),
      { params: { id: seededTaskId } },
    )
    expect(res.status).toBe(200)
  })
})
