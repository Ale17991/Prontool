import { redirect } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { can } from '@/lib/auth/rbac'
import { listTasks, type TaskStatusFilter } from '@/lib/core/tasks/list'
import { listTeamMembers } from '@/lib/core/team/list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NewTaskForm } from './new-task-form'
import { TasksFilters } from './tasks-filters'
import { TasksTable } from './tasks-table'

export const dynamic = 'force-dynamic'

const STATUS_FILTERS: TaskStatusFilter[] = ['pendente', 'concluida', 'atrasada', 'todas']

interface PageProps {
  searchParams: {
    status?: string
    assigned_to?: string
    from?: string
    to?: string
  }
}

export default async function TarefasPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'task.read')) redirect('/operacao/atendimentos')

  const supabase = createSupabaseServiceClient()
  const status = STATUS_FILTERS.includes(searchParams.status as TaskStatusFilter)
    ? (searchParams.status as TaskStatusFilter)
    : 'pendente'

  let assignedToFilter: string | undefined
  if (session.role === 'admin') {
    assignedToFilter = searchParams.assigned_to === 'me' ? session.userId : searchParams.assigned_to
  } else {
    assignedToFilter = session.userId
  }

  const tasks = await listTasks(supabase, {
    tenantId: session.tenantId,
    currentUserId: session.userId,
    role: session.role,
    status,
    assignedTo: assignedToFilter,
    from: searchParams.from,
    to: searchParams.to,
  })

  const canWrite = can(session.role, 'task.write')
  const isAdmin = session.role === 'admin'

  // Membros ativos do tenant — usados tanto no form de cadastro (admin
  // pode atribuir a outro) quanto no select de edição inline no modal.
  const members = isAdmin
    ? await listTeamMembers(supabase, {
        tenantId: session.tenantId,
        requesterId: session.userId,
      })
    : []
  const memberOptions = members
    .filter((m) => m.status !== 'disabled')
    .map((m) => ({ id: m.userId, label: m.fullName ?? m.email }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          Tarefas
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {tasks.length} tarefa{tasks.length === 1 ? '' : 's'} na visão atual.{' '}
          {isAdmin
            ? 'Como admin, você vê tarefas de toda a equipe.'
            : 'Você vê apenas as tarefas atribuídas a você.'}{' '}
          Clique numa linha para ver detalhes e ações.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Nova tarefa</CardTitle>
            </CardHeader>
            <CardContent>
              <NewTaskForm
                isAdmin={isAdmin}
                members={memberOptions}
                currentUserId={session.userId}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="space-y-3">
            <CardTitle className="text-sm">Tarefas cadastradas</CardTitle>
            <TasksFilters
              isAdmin={isAdmin}
              members={memberOptions}
              currentStatus={status}
              currentAssignedTo={searchParams.assigned_to}
              currentFrom={searchParams.from}
              currentTo={searchParams.to}
            />
          </CardHeader>
          <CardContent className="p-0">
            <TasksTable tasks={tasks} isAdmin={isAdmin} members={memberOptions} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
