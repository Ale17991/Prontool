/**
 * Feature 012 follow-up — PATCH /api/tarefas/[id] aceita edicao admin
 * de title/notes/due_date/assigned_to/priority. Non-admin recebe 403
 * quando tenta editar esses campos. Audit registra cada mudanca.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'

describe('Feature 012 follow-up — PATCH /api/tarefas edicao admin', () => {
  let tenantId: string
  let adminUserId: string
  let recepUserId: string
  let adminJwt: string
  let recepJwt: string
  let taskId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('tarefas-edit')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
    adminJwt = mintJwt({ userId: admin.userId, email: admin.email, tenantId, role: 'admin' })
    const recep = await seedUser(tenantId, 'recepcionista')
    recepUserId = recep.userId
    recepJwt = mintJwt({
      userId: recep.userId,
      email: recep.email,
      tenantId,
      role: 'recepcionista',
    })

    const sb = serviceClient()
    const { data, error } = await sb
      .from('tasks' as never)
      .insert({
        tenant_id: tenantId,
        title: 'Tarefa original',
        notes: 'observação inicial',
        due_date: '2030-01-01',
        assigned_to: recepUserId,
        assigned_by: adminUserId,
        priority: 'normal',
        created_by: adminUserId,
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`seed: ${error.message}`)
    taskId = (data as unknown as { id: string }).id
  })

  async function patchAs(jwt: string, body: unknown): Promise<Response> {
    const { PATCH } = await import('@/app/api/tarefas/[id]/route')
    return PATCH(
      new Request(`http://localhost/api/tarefas/${taskId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
      }),
      { params: { id: taskId } },
    )
  }

  it('admin edita title + notes + due_date + priority em uma chamada', async () => {
    const res = await patchAs(adminJwt, {
      title: 'Título corrigido',
      notes: 'nova observação',
      due_date: '2030-06-15',
      priority: 'alta',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      title: string
      notes: string
      due_date: string
      priority: string
    }
    expect(body.title).toBe('Título corrigido')
    expect(body.notes).toBe('nova observação')
    expect(body.due_date).toBe('2030-06-15')
    expect(body.priority).toBe('alta')
  })

  it('admin reatribui (assigned_to) para outro usuario do tenant', async () => {
    const res = await patchAs(adminJwt, { assigned_to: adminUserId })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { assigned_to: string }
    expect(body.assigned_to).toBe(adminUserId)
  })

  it('recepcionista tentando editar title → 403 FORBIDDEN', async () => {
    const res = await patchAs(recepJwt, { title: 'tentando editar' })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('FORBIDDEN')
    expect(body.error.message).toContain('title')
  })

  it('recepcionista (não responsavel mais) tentando soft_delete → 403', async () => {
    const res = await patchAs(recepJwt, { soft_delete: true })
    expect(res.status).toBe(403)
  })

  it('audit_log registra cada campo mudado pelo admin', async () => {
    const sb = serviceClient()
    const { data: audit } = await sb
      .from('audit_log')
      .select('field, reason')
      .eq('tenant_id', tenantId)
      .eq('entity', 'tasks')
      .eq('entity_id', taskId)
      .order('timestamp_utc', { ascending: true })

    const reasons = (audit ?? []).map((a) => a.reason)
    // criado + 4 edicoes do primeiro teste + reassign do segundo
    expect(reasons).toContain('task-created')
    expect(reasons).toContain('task-title-edited')
    expect(reasons).toContain('task-notes-edited')
    expect(reasons).toContain('task-due-date-edited')
    expect(reasons).toContain('task-priority-edited')
    expect(reasons).toContain('task-reassigned')
  })
})
