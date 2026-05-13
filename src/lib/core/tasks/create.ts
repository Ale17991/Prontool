import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

/**
 * Feature 012 — US1 — cria uma tarefa operacional.
 *
 * Service layer não bloqueia `assignedTo != actor` para não-admin;
 * a rota chamadora é responsável por forçar `assignedTo = session.userId`
 * para papéis não-admin. RLS no DB também aplica.
 */
export type TaskPriority = 'baixa' | 'normal' | 'alta' | 'urgente'

export interface CreateTaskInput {
  tenantId: string
  title: string
  notes?: string | null
  dueDate: string // YYYY-MM-DD
  assignedTo: string
  assignedBy: string
  priority: TaskPriority
}

export interface TaskRow {
  id: string
  tenant_id: string
  title: string
  notes: string | null
  due_date: string
  assigned_to: string
  assigned_by: string
  priority: TaskPriority
  status: 'pendente' | 'concluida'
  completed_at: string | null
  completed_by: string | null
  created_at: string
  created_by: string
  deleted_at: string | null
  deleted_by: string | null
}

export async function createTask(
  supabase: SupabaseClient<Database>,
  input: CreateTaskInput,
): Promise<TaskRow> {
  const title = input.title.trim()
  if (title.length < 1 || title.length > 200) {
    throw new ValidationError('Título da tarefa deve ter 1 a 200 caracteres')
  }
  const notes = input.notes?.trim() || null
  if (notes && notes.length > 1000) {
    throw new ValidationError('Observações limitadas a 1000 caracteres')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    throw new ValidationError('due_date deve estar em YYYY-MM-DD')
  }
  // Valida que assigned_to pertence ao tenant (defesa em camadas + RLS).
  const { data: ut, error: utErr } = await supabase
    .from('user_tenants')
    .select('user_id, status')
    .eq('tenant_id', input.tenantId)
    .eq('user_id', input.assignedTo)
    .maybeSingle()
  if (utErr) throw new Error(`createTask user_tenants lookup: ${utErr.message}`)
  if (!ut || (ut as { status: string }).status !== 'active') {
    throw new NotFoundError('user', input.assignedTo)
  }

  const { data, error } = await supabase
    .from('tasks' as never)
    .insert({
      tenant_id: input.tenantId,
      title,
      notes,
      due_date: input.dueDate,
      assigned_to: input.assignedTo,
      assigned_by: input.assignedBy,
      priority: input.priority,
      created_by: input.assignedBy,
    } as never)
    .select(
      'id, tenant_id, title, notes, due_date, assigned_to, assigned_by, priority, status, completed_at, completed_by, created_at, created_by, deleted_at, deleted_by',
    )
    .single()

  if (error) throw new Error(`createTask failed: ${error.message}`)
  return data as unknown as TaskRow
}
