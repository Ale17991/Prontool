'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronDown, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface DoctorFilterOption {
  id: string
  fullName: string
  active: boolean
}

interface Props {
  doctors: DoctorFilterOption[]
  selected: string[]
}

/**
 * Multi-select de profissionais para o calendario. Persiste a selecao no
 * querystring (`?doctors=id1,id2`) — sem cookie/localStorage.
 */
export function DoctorFilter({ doctors, selected }: Props) {
  const router = useRouter()
  const search = useSearchParams()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected))

  const summary = useMemo(() => {
    if (selected.length === 0) return 'Todos os profissionais'
    if (selected.length === 1) {
      const d = doctors.find((d) => d.id === selected[0])
      return d?.fullName ?? '1 profissional'
    }
    return `${selected.length} profissionais`
  }, [doctors, selected])

  function apply(next: Set<string>) {
    const params = new URLSearchParams(search?.toString() ?? '')
    if (next.size === 0 || next.size === doctors.length) {
      params.delete('doctors')
    } else {
      params.set('doctors', Array.from(next).join(','))
    }
    router.push(`?${params.toString()}`)
    setOpen(false)
  }

  function toggle(id: string) {
    const next = new Set(draft)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setDraft(next)
  }

  function selectAll() {
    setDraft(new Set(doctors.map((d) => d.id)))
  }

  function clearAll() {
    setDraft(new Set())
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setDraft(new Set(selected))
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2">
          <Users className="h-4 w-4 text-slate-500" />
          <span className="text-xs">{summary}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Profissionais
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={selectAll}
              className="text-[11px] text-link hover:text-link-hover hover:underline"
            >
              Todos
            </button>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-slate-500 hover:underline"
            >
              Limpar
            </button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {doctors.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              Nenhum profissional cadastrado.
            </p>
          ) : (
            doctors.map((d) => {
              const checked = draft.has(d.id)
              return (
                <button
                  type="button"
                  key={d.id}
                  onClick={() => toggle(d.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50',
                    checked && 'bg-blue-50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked
                        ? 'border-primary bg-primary text-white'
                        : 'border-slate-300 bg-white',
                    )}
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className={cn('flex-1 truncate', !d.active && 'text-slate-400')}>
                    {d.fullName}
                  </span>
                  {!d.active ? (
                    <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                      inativo
                    </Badge>
                  ) : null}
                </button>
              )
            })
          )}
        </div>
        <div className="flex justify-end border-t border-slate-100 px-3 py-2">
          <Button size="sm" onClick={() => apply(draft)} disabled={draft.size === 0}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
