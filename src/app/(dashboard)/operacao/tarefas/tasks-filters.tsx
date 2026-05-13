'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface MemberOption {
  id: string
  label: string
}

interface Props {
  isAdmin: boolean
  members: MemberOption[]
  currentStatus: string
  currentAssignedTo?: string
  currentFrom?: string
  currentTo?: string
}

export function TasksFilters({
  isAdmin,
  members,
  currentStatus,
  currentAssignedTo,
  currentFrom,
  currentTo,
}: Props) {
  return (
    <form method="GET" className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor="f-status" className="text-[10px] uppercase tracking-widest text-slate-500">
          Status
        </Label>
        <Select name="status" defaultValue={currentStatus}>
          <SelectTrigger id="f-status" className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="concluida">Concluídas</SelectItem>
            <SelectItem value="atrasada">Atrasadas</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isAdmin ? (
        <div className="space-y-1">
          <Label htmlFor="f-assigned" className="text-[10px] uppercase tracking-widest text-slate-500">
            Responsável
          </Label>
          <Select name="assigned_to" defaultValue={currentAssignedTo ?? ''}>
            <SelectTrigger id="f-assigned" className="h-8 w-40 text-xs">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="me">Eu mesma</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="f-from" className="text-[10px] uppercase tracking-widest text-slate-500">
          De
        </Label>
        <Input
          id="f-from"
          name="from"
          type="date"
          defaultValue={currentFrom ?? ''}
          className="h-8 w-36 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-to" className="text-[10px] uppercase tracking-widest text-slate-500">
          Até
        </Label>
        <Input
          id="f-to"
          name="to"
          type="date"
          defaultValue={currentTo ?? ''}
          className="h-8 w-36 text-xs"
        />
      </div>
      <button
        type="submit"
        className="h-8 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
      >
        Filtrar
      </button>
    </form>
  )
}
