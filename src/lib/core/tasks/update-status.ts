import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import type { TaskPriority, TaskRow } from './create'

export interface UpdateTaskInput {
  tenantId: string
  id: string
  status?: 'pendente' | 'concluida'
  notes?: string | null
  priority?: TaskPriority
  actorUserId: string
}

/**
 * Feature 012 — US1 — atualiza colunas mutáveis de uma tarefa.
 *
 * - status='concluida' → set completed_at=now, completed_by=actor
 * - status='pendente'  → zera completed_at/completed_by (reabertura)
 * - notes/priority livres
 *
 * Imutabilidade de outras colunas é garantida pelo trigger SQL
 * `enforce_tasks_mutation`.
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
  if (input.notes !== undefined) {
    const n = input.notes?.trim() || null
    if (n && n.length > 1000) throw new ValidationError('Observações limitadas a 1000 chars')
    patch.notes = n
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
