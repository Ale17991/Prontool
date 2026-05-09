'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, ListFilter } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  TussTableBadge,
  type TussTable,
} from '@/app/(dashboard)/configuracoes/procedimentos/tuss-table-badge'
import { TussListDialog, type TussListItem } from './tuss-list-dialog'

export interface TussTypeaheadValue {
  code: string
  description: string
  tussTable: TussTable
  manufacturer: string | null
}

export interface TussTypeaheadProps {
  table: TussTable
  value: TussTypeaheadValue | null
  onChange: (value: TussTypeaheadValue | null) => void
  placeholder?: string
  /** Esconde o botao "Ver em lista". Padrao: false. */
  hideListButton?: boolean
  /** id do trigger button (para Label htmlFor). */
  id?: string
}

interface RawHit {
  code: string
  description: string
  manufacturer?: string | null
  tussTable?: TussTable
}

/**
 * Typeahead reutilizavel de codigos TUSS. Reproduz o comportamento do popover
 * usado em /configuracoes/procedimentos (largura ampla, nomes em ate 2 linhas) e
 * inclui um botao "Ver em lista" que abre <TussListDialog>.
 *
 * Reusado por:
 *   - /configuracoes/procedimentos (Novo procedimento)
 *   - /operacao/atendimentos/novo (Novo atendimento)
 *   - /operacao/pacientes/[id]   (Nova etapa)
 */
export function TussTypeahead({
  table,
  value,
  onChange,
  placeholder = 'Buscar por código ou nome…',
  hideListButton = false,
  id,
}: TussTypeaheadProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<TussTypeaheadValue[]>([])
  const [listOpen, setListOpen] = useState(false)

  useEffect(() => {
    if (!search.trim()) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: search.trim(),
          table,
          limit: '30',
        })
        const res = await fetch(`/api/tuss-codes?${params.toString()}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) return
        const data = (await res.json()) as RawHit[]
        setResults(
          data.map<TussTypeaheadValue>((d) => ({
            code: d.code,
            description: d.description,
            tussTable: d.tussTable ?? table,
            manufacturer: d.manufacturer ?? null,
          })),
        )
      } catch {
        /* aborted or network error — user can retry */
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [search, table])

  function pick(item: TussTypeaheadValue) {
    onChange(item)
    setOpen(false)
  }

  function pickFromList(item: TussListItem) {
    onChange({
      code: item.code,
      description: item.description,
      tussTable: item.tussTable,
      manufacturer: item.manufacturer,
    })
  }

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="flex-1 justify-between font-normal"
          >
            <span className="truncate">
              {value ? `${value.code} — ${value.description}` : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(720px,calc(100vw-2rem))] min-w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Digite para buscar…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty className="py-6 text-center text-xs text-slate-500">
                {search.trim() ? 'Nenhum resultado.' : 'Digite ao menos 2 caracteres.'}
              </CommandEmpty>
              {results.length > 0 ? (
                <CommandGroup heading="Catálogo TUSS">
                  {results.map((item) => (
                    <CommandItem
                      key={item.code}
                      value={`${item.code} ${item.description} ${item.manufacturer ?? ''}`}
                      onSelect={() => pick(item)}
                      className="cursor-pointer items-start py-2 text-xs"
                    >
                      <Check
                        className={cn(
                          'mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary',
                          value?.code === item.code ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <TussTableBadge table={item.tussTable} className="mr-2 mt-0.5 shrink-0" />
                      <span className="mr-2 mt-0.5 shrink-0 font-bold text-slate-900">
                        {item.code}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="line-clamp-2 whitespace-normal break-words text-slate-700">
                          {item.description}
                        </span>
                        {item.manufacturer ? (
                          <span className="line-clamp-2 whitespace-normal break-words text-[10px] text-slate-400">
                            {item.manufacturer}
                          </span>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {!hideListButton ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setListOpen(true)}
          className="h-9 gap-1.5"
          title="Ver catálogo completo em lista"
        >
          <ListFilter className="h-3.5 w-3.5" />
          <span className="text-xs">Ver em lista</span>
        </Button>
      ) : null}

      <TussListDialog
        open={listOpen}
        onOpenChange={setListOpen}
        table={table}
        initialQuery={search}
        onSelect={pickFromList}
      />
    </div>
  )
}
