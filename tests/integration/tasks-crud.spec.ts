/**
 * T023 (Feature 012) — CRUD end-to-end de tarefas + audit_log.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { createTask } from '@/lib/core/tasks/create'
import { listTasks } from '@/lib/core/tasks/list'
import { updateTask } from '@/lib/core/tasks/update-status'
import { softDeleteTask } from '@/lib/core/tasks/soft-delete'

describe('Feature 012 — tasks CRUD + audit', () => {
  let tenantId: string
  let adminUserId: string
  let recepUserId: string

  beforeAll(async () => {
    await resetDatabase()
    const t = await seedTenant('tasks-crud')
    tenantId = t.tenantId
    const admin = await seedUser(tenantId, 'admin')
    adminUserId = admin.userId
    const recep = await seedUser(tenantId, 'recepcionista')
    recepUserId = recep.userId
  })

  it('cria, lista, conclui, reabre, soft-delete — tudo auditado', async () => {
    const sb = serviceClient()

    // CREATE
    const created = await createTask(sb, {
      tenantId,
      title: 'Ligar para paciente',
      notes: 'Confirmar horário',
      dueDate: '2030-01-01',
      assignedTo: recepUserId,
      assignedBy: adminUserId,
      priority: 'alta',
    })
    expect(created.status).toBe('pendente')
    expect(created.completed_at).toBeNull()

    // LIST (admin)
    const all = await listTasks(sb, {
      tenantId,
      currentUserId: adminUserId,
      role: 'admin',
      status: 'todas',
    })
    expect(all.find((t) => t.id === created.id)).toBeDefined()

    // COMPLETE
    const completed = await updateTask(sb, {
      tenantId,
      id: created.id,
      status: 'concluida',
      actorUserId: recepUserId,
    })
    expect(completed.status).toBe('concluida')
    expect(completed.completed_at).not.toBeNull()
    expect(completed.completed_by).toBe(recepUserId)

    // REOPEN
    const reopened = await updateTask(sb, {
      tenantId,
      id: created.id,
      status: 'pendente',
      actorUserId: adminUserId,
    })
    expect(reopened.status).toBe('pendente')
    expect(reopened.completed_at).toBeNull()

    // SOFT DELETE
    await softDeleteTask(sb, { tenantId, id: created.id, actorUserId: adminUserId })

    // Audit_log: 4 reasons distintos
    const { data: audit } = await sb
      .from('audit_log')
      .select('reason')
      .eq('tenant_id', tenantId)
      .eq('entity', 'tasks')
      .eq('entity_id', created.id)
      .order('timestamp_utc', { ascending: true })

    const reasons = (audit ?? []).map((a) => a.reason)
    expect(reasons).toContain('task-created')
    expect(reasons).toContain('task-completed')
    expect(reasons).toContain('task-reopened')
    expect(reasons).toContain('task-soft-deleted')
  })
})
