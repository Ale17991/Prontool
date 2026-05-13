'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
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

interface MemberOption {
  id: string
  label: string
}

interface Props {
  isAdmin: boolean
  members: MemberOption[]
  currentUserId: string
}

type Priority = 'baixa' | 'normal' | 'alta' | 'urgente'

export function NewTaskForm({ isAdmin, members, currentUserId }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [assignedTo, setAssignedTo] = useState(currentUserId)
  const [priority, setPriority] = useState<Priority>('normal')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setPending(true)
    try {
      const res = await fetch('/api/tarefas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          notes: notes.trim() || null,
          due_date: dueDate,
          assigned_to: isAdmin ? assignedTo : currentUserId,
          priority,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
      setSuccess('Tarefa cadastrada.')
      setTitle('')
      setNotes('')
      setPriority('normal')
      if (isAdmin) setAssignedTo(currentUserId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="task-title" className="text-xs">
          Título
        </Label>
        <Input
          id="task-title"
          required
          minLength={1}
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex.: Ligar para paciente João"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="task-notes" className="text-xs">
          Observações (opcional)
        </Label>
        <Textarea
          id="task-notes"
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="task-due" className="text-xs">
            Data limite
          </Label>
          <Input
            id="task-due"
            required
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-priority" className="text-xs">
            Prioridade
          </Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger id="task-priority">
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
        <Label htmlFor="task-assigned" className="text-xs">
          Responsável
        </Label>
        {isAdmin ? (
          <Select value={assignedTo} onValueChange={setAssignedTo}>
            <SelectTrigger id="task-assigned">
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
        ) : (
          <Input value="Eu mesma" disabled readOnly className="text-xs" />
        )}
      </div>
      <Button type="submit" disabled={pending || title.trim().length === 0} className="w-full">
        {pending ? 'Salvando…' : 'Cadastrar tarefa'}
      </Button>
      {error ? (
        <p className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-xs font-medium text-emerald-700">
          {success}
        </p>
      ) : null}
    </form>
  )
}
