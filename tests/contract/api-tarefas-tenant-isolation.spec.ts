/**
 * T021 (Feature 012) — tenant isolation /api/tarefas.
 *
 * Tenant A não vê/altera tarefa de tenant B.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 012 — tenant isolation /api/tarefas', () => {
  let adminAjwt: string
  let taskOfB: string

  beforeAll(async () => {
    await resetDatabase()
    const tenantA = (await seedTenant('tarefas-iso-a')).tenantId
    const tenantB = (await seedTenant('tarefas-iso-b')).tenantId
    const adminA = await seedUser(tenantA, 'admin')
    const adminB = await seedUser(tenantB, 'admin')
    adminAjwt = mintJwt({
      userId: adminA.userId,
      email: adminA.email,
      tenantId: tenantA,
      role: 'admin',
    })

    const sb = serviceClient()
    const { data } = await sb
      .from('tasks' as never)
      .insert({
        tenant_id: tenantB,
        title: 'tarefa B',
        due_date: '2026-12-31',
        assigned_to: adminB.userId,
        assigned_by: adminB.userId,
        priority: 'normal',
        created_by: adminB.userId,
      } as never)
      .select('id')
      .single()
    taskOfB = (data as unknown as { id: string }).id
  })

  it('admin tenant A GET → não retorna task de B', async () => {
    const { GET } = await import('@/app/api/tarefas/route')
    const res = await GET(
      new Request('http://localhost/api/tarefas?status=todas', {
        headers: { authorization: `Bearer ${adminAjwt}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string }>
    expect(body.find((t) => t.id === taskOfB)).toBeUndefined()
  })

  it('admin tenant A PATCH task de B → 404', async () => {
    const { PATCH } = await import('@/app/api/tarefas/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/tarefas/${taskOfB}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminAjwt}`,
        },
        body: JSON.stringify({ status: 'concluida' }),
      }),
      { params: { id: taskOfB } },
    )
    expect(res.status).toBe(404)
  })
})
