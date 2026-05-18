'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { ListedTask } from '@/lib/core/tasks/list'
import { TaskDetailDialog } from './task-detail-dialog'

interface MemberOption {
  id: string
  label: string
}

interface Props {
  tasks: ListedTask[]
  isAdmin: boolean
  members: MemberOption[]
}

// 016 — consome tokens do design system. urgente usa --alert (vermelho
// clinico distinto de --destructive). alta usa amber/warning. normal
// usa info do designer. baixa usa neutro slate.
const PRIORITY_BADGE: Record<string, string> = {
  baixa: 'bg-slate-100 text-slate-700',
  normal: 'bg-info-bg text-info-text',
  alta: 'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning-foreground))]',
  urgente: 'bg-[hsl(var(--alert)/0.1)] text-[hsl(var(--alert))]',
}

export function TasksTable({ tasks, isAdmin, members }: Props) {
  const [selected, setSelected] = useState<ListedTask | null>(null)

  if (tasks.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-sm text-slate-500">
        Nenhuma tarefa para os filtros atuais.
      </p>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Título</TableHead>
            <TableHead>Responsável</TableHead>
            <TableHead>Data limite</TableHead>
            <TableHead>Prioridade</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((t) => (
            <TableRow
              key={t.id}
              onClick={() => setSelected(t)}
              className={cn(
                'cursor-pointer transition-colors hover:bg-slate-50',
                t.is_overdue && 'bg-rose-50/40 hover:bg-rose-50/60',
              )}
            >
              <TableCell>
                <p className="font-semibold text-slate-900">{t.title}</p>
                {t.notes ? (
                  <p className="line-clamp-1 text-[11px] text-slate-500">{t.notes}</p>
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
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <TaskDetailDialog
        task={selected}
        isAdmin={isAdmin}
        members={members}
        onClose={() => setSelected(null)}
      />
    </>
  )
}
