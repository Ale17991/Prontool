import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import type { TaskPriority, TaskRow } from './create'

export interface UpdateTaskInput {
  tenantId: string
  id: string
  /** Concluir/reabrir — qualquer responsavel ou admin. */
  status?: 'pendente' | 'concluida'
  /** Campos editaveis (admin-only — caller valida session.role). */
  title?: string
  notes?: string | null
  dueDate?: string
  assignedTo?: string
  priority?: TaskPriority
  actorUserId: string
}

/**
 * Feature 012 — US1 — atualiza colunas mutaveis de uma tarefa.
 *
 * - status='concluida' -> completed_at=now + completed_by=actor
 * - status='pendente'  -> zera completed_at/completed_by (reabertura)
 * - title/notes/dueDate/assignedTo/priority — admin-only (route valida)
 *
 * Trigger `enforce_tasks_mutation` bloqueia mudanca de title/due_date/
 * assigned_to para role `authenticated`. O service_role usado pela API
 * bypassa o trigger; a defesa de admin-only fica no caller (route handler).
 */
export async function updateTask(
  supabase: SupabaseClient<Database>,
  input: UpdateTaskInput,
): Promise<TaskRow> {
  const patch: Record<string, unknown> = {}
  if (input.status !== undefined) {
    patch.status = input.status
    if (input.status === 'concluida') {
      patch.completed_at = new Date().toISOString()
      patch.completed_by = input.actorUserId
    } else {
      patch.completed_at = null
      patch.completed_by = null
    }
  }
  if (input.title !== undefined) {
    const t = input.title.trim()
    if (t.length < 1 || t.length > 200) {
      throw new ValidationError('Título da tarefa deve ter 1 a 200 caracteres')
    }
    patch.title = t
  }
  if (input.notes !== undefined) {
    const n = input.notes?.trim() || null
    if (n && n.length > 1000) throw new ValidationError('Observações limitadas a 1000 chars')
    patch.notes = n
  }
  if (input.dueDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
      throw new ValidationError('due_date deve estar em YYYY-MM-DD')
    }
    patch.due_date = input.dueDate
  }
  if (input.assignedTo !== undefined) {
    const { data: ut, error: utErr } = await supabase
      .from('user_tenants')
      .select('user_id, status')
      .eq('tenant_id', input.tenantId)
      .eq('user_id', input.assignedTo)
      .maybeSingle()
    if (utErr) throw new Error(`updateTask user_tenants lookup: ${utErr.message}`)
    if (!ut || (ut as { status: string }).status !== 'active') {
      throw new NotFoundError('user', input.assignedTo)
    }
    patch.assigned_to = input.assignedTo
  }
  if (input.priority !== undefined) {
    patch.priority = input.priority
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Nenhum campo informado para atualização')
  }

  const { data, error } = await supabase
    .from('tasks' as never)
    .update(patch as never)
    .eq('id', input.id)
    .eq('tenant_id', input.tenantId)
    .select(
      'id, tenant_id, title, notes, due_date, assigned_to, assigned_by, priority, status, completed_at, completed_by, created_at, created_by, deleted_at, deleted_by',
    )
    .maybeSingle()

  if (error) throw new Error(`updateTask failed: ${error.message}`)
  if (!data) throw new NotFoundError('task', input.id)
  return data as unknown as TaskRow
}
