/**
 * T022 (Feature 012) — validação Zod /api/tarefas POST.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 012 — POST /api/tarefas validation', () => {
  let adminJwt: string
  let adminUserId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('tarefas-val')
    const admin = await seedUser(t.tenantId, 'admin')
    adminUserId = admin.userId
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId: t.tenantId, role: 'admin' })
  })

  async function postBody(body: unknown): Promise<Response> {
    const { POST } = await import('@/app/api/tarefas/route')
    return POST(
      new Request('http://localhost/api/tarefas', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify(body),
      }),
    )
  }

  it('rejeita title vazio', async () => {
    expect((await postBody({ title: '', due_date: '2026-12-31', assigned_to: adminUserId, priority: 'normal' })).status).toBe(400)
  })
  it('rejeita title com 201 chars', async () => {
    expect((await postBody({ title: 'x'.repeat(201), due_date: '2026-12-31', assigned_to: adminUserId, priority: 'normal' })).status).toBe(400)
  })
  it('rejeita due_date formato inválido', async () => {
    expect((await postBody({ title: 'x', due_date: '31/12/2026', assigned_to: adminUserId, priority: 'normal' })).status).toBe(400)
  })
  it('rejeita priority inválida', async () => {
    expect((await postBody({ title: 'x', due_date: '2026-12-31', assigned_to: adminUserId, priority: 'critica' })).status).toBe(400)
  })
  it('aceita payload válido', async () => {
    expect((await postBody({ title: 'tarefa válida', due_date: '2026-12-31', assigned_to: adminUserId, priority: 'alta' })).status).toBe(201)
  })
})
