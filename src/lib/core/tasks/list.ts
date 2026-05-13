import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TenantRole } from '@/lib/db/types'
import type { TaskRow, TaskPriority } from './create'

export type TaskStatusFilter = 'pendente' | 'concluida' | 'atrasada' | 'todas'

export interface ListTasksInput {
  tenantId: string
  currentUserId: string
  role: TenantRole
  status?: TaskStatusFilter
  assignedTo?: string
  from?: string
  to?: string
  includeDeleted?: boolean
}

export interface ListedTask extends TaskRow {
  is_overdue: boolean
  assigned_to_name: string | null
  created_by_name: string | null
  priority: TaskPriority
}

/**
 * Feature 012 — US1 — lista tarefas do tenant respeitando RLS.
 *
 * - Admin: pode filtrar por `assignedTo` (uuid) ou ver todas. Default: todas.
 * - Demais: filtro `assignedTo` IGNORADO (RLS já restringe a quem é responsável).
 *
 * Ordenação default: is_overdue DESC (atrasadas primeiro), due_date ASC, created_at DESC.
 */
export async function listTasks(
  supabase: SupabaseClient<Database>,
  input: ListTasksInput,
): Promise<ListedTask[]> {
  let q = supabase
    .from('tasks' as never)
    .select(
      'id, tenant_id, title, notes, due_date, assigned_to, assigned_by, priority, status, completed_at, completed_by, created_at, created_by, deleted_at, deleted_by',
    )
    .eq('tenant_id', input.tenantId)
    .order('due_date', { ascending: true })
    .order('created_at', { ascending: false })

  if (!input.includeDeleted) {
    q = q.is('deleted_at', null)
  }

  // Status
  const today = new Date().toISOString().slice(0, 10)
  switch (input.status ?? 'pendente') {
    case 'pendente':
      q = q.eq('status', 'pendente')
      break
    case 'concluida':
      q = q.eq('status', 'concluida')
      break
    case 'atrasada':
      q = q.eq('status', 'pendente').lt('due_date', today)
      break
    case 'todas':
      // sem filtro
      break
  }

  // assignedTo (admin pode filtrar; demais ignorado — RLS força auth.uid())
  if (input.role === 'admin' && input.assignedTo) {
    q = q.eq('assigned_to', input.assignedTo)
  }

  if (input.from) q = q.gte('due_date', input.from)
  if (input.to) q = q.lte('due_date', input.to)

  const { data, error } = await q
  if (error) throw new Error(`listTasks failed: ${error.message}`)
  const rows = (data ?? []) as unknown as TaskRow[]

  // Carrega user_profile (full_name) para projetar nomes
  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.assigned_to, r.created_by])),
  )
  const nameByUser = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profile')
      .select('user_id, full_name')
      .in('user_id', userIds)
    for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      if (p.full_name) nameByUser.set(p.user_id, p.full_name)
    }
  }

  return rows.map((r) => ({
    ...r,
    is_overdue: r.status === 'pendente' && r.due_date < today,
    assigned_to_name: nameByUser.get(r.assigned_to) ?? null,
    created_by_name: nameByUser.get(r.created_by) ?? null,
  }))
}
