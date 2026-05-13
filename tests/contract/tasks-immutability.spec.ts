/**
 * T019 (Feature 012) — Constitution Principle I: imutabilidade parcial da tabela tasks.
 *
 * Triggers da migration 0078:
 *  - enforce_tasks_mutation: bloqueia UPDATE de title/due_date/assigned_to/...
 *  - tasks_no_physical_delete: bloqueia DELETE.
 * status/notes/priority/completed_* permanecem mutáveis (com audit).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  resetDatabase,
  rlsClient,
  serviceClient,
} from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 012 — tasks immutability', () => {
  let tenantId: string
  let adminJwt: string
  let adminUserId: string
  let taskId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('tasks-imm')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
  })

  beforeEach(async () => {
    const sb = serviceClient()
    const { data, error } = await sb
      .from('tasks' as never)
      .insert({
        tenant_id: tenantId,
        title: 'Tarefa de teste',
        due_date: '2026-12-31',
        assigned_to: adminUserId,
        assigned_by: adminUserId,
        priority: 'normal',
        created_by: adminUserId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed task failed: ${error.message}`)
    taskId = (data as unknown as { id: string }).id
  })

  it('UPDATE title é rejeitado pelo trigger', async () => {
    const sb = rlsClient(adminJwt)
    const { error } = await sb
      .from('tasks' as never)
      .update({ title: 'OUTRO_TITULO' } as never)
      .eq('id', taskId)
    expect(error).not.toBeNull()
  })

  it('UPDATE due_date é rejeitado pelo trigger', async () => {
    const sb = rlsClient(adminJwt)
    const { error } = await sb
      .from('tasks' as never)
      .update({ due_date: '2027-01-01' } as never)
      .eq('id', taskId)
    expect(error).not.toBeNull()
  })

  it('UPDATE status (mutável) é PERMITIDO via API route', async () => {
    const { PATCH } = await import('@/app/api/tarefas/[id]/route')
    const res = await PATCH(
      new Request(`http://localhost/api/tarefas/${taskId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({ status: 'concluida' }),
      }),
      { params: { id: taskId } },
    )
    expect(res.status).toBe(200)

    const sb = serviceClient()
    const { data } = await sb
      .from('tasks' as never)
      .select('status, completed_at, completed_by')
      .eq('id', taskId)
      .single()
    expect((data as unknown as { status: string }).status).toBe('concluida')
  })

  it('DELETE físico é rejeitado por enforce_append_only', async () => {
    const sb = rlsClient(adminJwt)
    const { error } = await sb.from('tasks' as never).delete().eq('id', taskId)
    expect(error).not.toBeNull()
    const sbSvc = serviceClient()
    const { data } = await sbSvc
      .from('tasks' as never)
      .select('id')
      .eq('id', taskId)
      .maybeSingle()
    expect(data).not.toBeNull()
  })
})
