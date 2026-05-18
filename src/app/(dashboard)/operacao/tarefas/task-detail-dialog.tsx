'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { ListedTask } from '@/lib/core/tasks/list'

interface MemberOption {
  id: string
  label: string
}

interface Props {
  task: ListedTask | null
  isAdmin: boolean
  members: MemberOption[]
  onClose: () => void
}

type Priority = 'baixa' | 'normal' | 'alta' | 'urgente'

// 016 — design system tokens. Sincronizado com tasks-table.tsx.
const PRIORITY_BADGE: Record<Priority, string> = {
  baixa: 'bg-slate-100 text-slate-700',
  normal: 'bg-info-bg text-info-text',
  alta: 'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning-foreground))]',
  urgente: 'bg-[hsl(var(--alert)/0.1)] text-[hsl(var(--alert))]',
}

export function TaskDetailDialog({ task, isAdmin, members, onClose }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Edit fields (initialized from task)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')

  // Sincroniza estado de edicao quando uma nova task abre.
  function startEdit() {
    if (!task) return
    setTitle(task.title)
    setNotes(task.notes ?? '')
    setDueDate(task.due_date)
    setAssignedTo(task.assigned_to)
    setPriority(task.priority)
    setError(null)
    setEditing(true)
  }

  function close() {
    setEditing(false)
    setError(null)
    onClose()
  }

  async function patch(body: unknown) {
    if (!task) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/tarefas/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const p = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(p.error?.message ?? `HTTP ${res.status}`)
      }
      router.refresh()
      setEditing(false)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  async function onSubmitEdit(e: FormEvent) {
    e.preventDefault()
    // Envia somente o que MUDOU (não enviar campos inalterados evita
    // gerar audit_log ruidoso quando o admin abre e salva sem mexer).
    const body: Record<string, unknown> = {}
    if (task) {
      if (title.trim() !== task.title) body.title = title.trim()
      const trimmedNotes = notes.trim() || null
      if (trimmedNotes !== (task.notes ?? null)) body.notes = trimmedNotes
      if (dueDate !== task.due_date) body.due_date = dueDate
      if (assignedTo !== task.assigned_to) body.assigned_to = assignedTo
      if (priority !== task.priority) body.priority = priority
    }
    if (Object.keys(body).length === 0) {
      setEditing(false)
      return
    }
    await patch(body)
  }

  async function onToggleStatus() {
    if (!task) return
    await patch({ status: task.status === 'pendente' ? 'concluida' : 'pendente' })
  }

  async function onDelete() {
    if (!task) return
    if (!confirm('Tem certeza que deseja excluir esta tarefa?')) return
    await patch({ soft_delete: true })
  }

  if (!task) return null

  const isOverdue = task.is_overdue
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR')
  const formatDateOnly = (yyyymmdd: string) =>
    new Date(yyyymmdd + 'T00:00:00').toLocaleDateString('pt-BR')

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">
            {editing ? 'Editar tarefa' : task.title}
          </DialogTitle>
        </DialogHeader>

        {editing && isAdmin ? (
          /* ----- MODO EDIÇÃO (admin) ----- */
          <form onSubmit={onSubmitEdit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ed-title" className="text-xs">Título</Label>
              <Input
                id="ed-title"
                required
                minLength={1}
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-notes" className="text-xs">Observações</Label>
              <Textarea
                id="ed-notes"
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ed-due" className="text-xs">Data limite</Label>
                <Input
                  id="ed-due"
                  required
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed-priority" className="text-xs">Prioridade</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                  <SelectTrigger id="ed-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-assigned" className="text-xs">Responsável</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger id="ed-assigned">
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Salvando…
                  </>
                ) : (
                  'Salvar alterações'
                )}
              </Button>
            </div>
          </form>
        ) : (
          /* ----- MODO VISUALIZAÇÃO ----- */
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className={PRIORITY_BADGE[task.priority]}>
                {task.priority}
              </Badge>
              {task.status === 'concluida' ? (
                <Badge variant="success">Concluída</Badge>
              ) : (
                <Badge variant="outline">Pendente</Badge>
              )}
              {isOverdue ? <Badge variant="destructive">Atrasada</Badge> : null}
            </div>

            {task.notes ? (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Observações
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                  {task.notes}
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <DetailRow label="Responsável" value={task.assigned_to_name ?? '—'} />
              <DetailRow label="Criado por" value={task.created_by_name ?? '—'} />
              <DetailRow
                label="Data limite"
                value={formatDateOnly(task.due_date)}
                emphasis={isOverdue ? 'rose' : undefined}
              />
              <DetailRow
                label="Criado em"
                value={formatDate(task.created_at)}
              />
              {task.completed_at ? (
                <DetailRow
                  label="Concluído em"
                  value={formatDate(task.completed_at)}
                />
              ) : null}
            </div>

            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={task.status === 'pendente' ? 'default' : 'outline'}
                  size="sm"
                  onClick={onToggleStatus}
                  disabled={pending}
                >
                  {pending ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {task.status === 'pendente' ? 'Concluir' : 'Reabrir'}
                </Button>
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={startEdit}
                    disabled={pending}
                  >
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Editar
                  </Button>
                ) : null}
              </div>
              <div className="flex gap-2">
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onDelete}
                    disabled={pending}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Excluir
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  Fechar
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DetailRow({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: 'rose'
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 font-semibold tabular-nums',
          emphasis === 'rose' ? 'text-destructive' : 'text-slate-900',
        )}
      >
        {value}
      </p>
    </div>
  )
}
