import { redirect } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { can } from '@/lib/auth/rbac'
import { listTasks, type TaskStatusFilter } from '@/lib/core/tasks/list'
import { listTeamMembers } from '@/lib/core/team/list'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { NewTaskForm } from './new-task-form'
import { TaskRowActions } from './task-row-actions'
import { TasksFilters } from './tasks-filters'

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

const PRIORITY_BADGE: Record<string, string> = {
  baixa: 'bg-slate-100 text-slate-700',
  normal: 'bg-blue-50 text-blue-700',
  alta: 'bg-amber-50 text-amber-700',
  urgente: 'bg-rose-50 text-rose-700',
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
    assignedToFilter = searchParams.assigned_to === 'me'
      ? session.userId
      : searchParams.assigned_to
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

  // Lista de membros para o select de responsável (admin filtra por outros).
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
            : 'Você vê apenas as tarefas atribuídas a você.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Nova tarefa</CardTitle>
            </CardHeader>
            <CardContent>
              <NewTaskForm isAdmin={isAdmin} members={memberOptions} currentUserId={session.userId} />
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
            {tasks.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">
                Nenhuma tarefa para os filtros atuais.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Data limite</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((t) => (
                    <TableRow
                      key={t.id}
                      className={cn(t.is_overdue && 'bg-rose-50/40')}
                    >
                      <TableCell>
                        <p className="font-semibold text-slate-900">{t.title}</p>
                        {t.notes ? (
                          <p className="line-clamp-2 text-[11px] text-slate-500">{t.notes}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {t.assigned_to_name ?? '—'}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-xs font-semibold tabular-nums',
                          t.is_overdue ? 'text-rose-700' : 'text-slate-700',
                        )}
                      >
                        {new Date(t.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                        {t.is_overdue ? (
                          <span className="ml-1 text-[10px] uppercase tracking-widest">
                            Atrasada
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={PRIORITY_BADGE[t.priority]}>
                          {t.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {t.status === 'concluida' ? (
                          <Badge variant="success">Concluída</Badge>
                        ) : (
                          <Badge variant="outline">Pendente</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canWrite ? (
                          <TaskRowActions
                            id={t.id}
                            status={t.status}
                            isAdmin={isAdmin}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
