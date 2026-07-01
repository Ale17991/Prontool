'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, ChevronLeft, ChevronRight, ListFilter, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface LocalProcedureOption {
  id: string
  /** TUSS code OU codigo personalizado (custom_procedure_codes.code) OU
   * "(não listado)" quando unlisted sem codigo. */
  tussCode: string | null
  displayName: string | null
  /** Procedimento e coberto pelo plano? Quando false, agendamento sempre vira particular. */
  coveredByPlan?: boolean
  /** Valor particular cadastrado em cents — null se nao cadastrado. */
  defaultAmountCents?: number | null
  /** true = procedimento sem codigo TUSS oficial (unlisted ou com codigo
   * personalizado). Atendimento pula validacao TUSS. */
  isUnlisted?: boolean
  /** true = procedimento tem codigo personalizado da clinica
   * (custom_procedure_codes). Mostra badge "Personalizado" no dropdown. */
  isCustomCoded?: boolean
}

/**
 * Monta o texto do botao/item do typeahead.
 *   - TUSS listado: "12345 — Nome"
 *   - Personalizado: "PKG-001 — Nome"
 *   - Unlisted sem codigo: "Não listado — Nome" ou só "Nome"
 *   - Sempre defensivo contra tussCode null/undefined (nunca renderiza "null").
 */
export function formatProcedureLabel(o: LocalProcedureOption): string {
  const code = typeof o.tussCode === 'string' && o.tussCode.trim().length > 0 ? o.tussCode : null
  const name =
    typeof o.displayName === 'string' && o.displayName.trim().length > 0 ? o.displayName : null
  if (code && name) return `${code} — ${name}`
  if (code) return code
  if (name) return name
  return '(procedimento sem nome)'
}

export interface LocalProcedureTypeaheadProps {
  options: LocalProcedureOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  id?: string
}

const PAGE_SIZE = 20

/**
 * Typeahead client-side sobre uma lista ja carregada de procedures do tenant.
 * Acompanha a UX de TussTypeahead (popover largo, 2 linhas, "Ver em lista")
 * mas opera apenas em memoria — sem fetch.
 */
export function LocalProcedureTypeahead({
  options,
  value,
  onChange,
  placeholder = 'Buscar por código ou nome…',
  id,
}: LocalProcedureTypeaheadProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [page, setPage] = useState(1)

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length === 0) return options.slice(0, 50)
    return options
      .filter((o) => {
        const code = typeof o.tussCode === 'string' ? o.tussCode.toLowerCase() : ''
        const name = (o.displayName ?? '').toLowerCase()
        return code.includes(q) || name.includes(q)
      })
      .slice(0, 50)
  }, [options, search])

  const listFiltered = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    if (q.length === 0) return options
    return options.filter((o) => {
      const code = typeof o.tussCode === 'string' ? o.tussCode.toLowerCase() : ''
      const name = (o.displayName ?? '').toLowerCase()
      return code.includes(q) || name.includes(q)
    })
  }, [options, listSearch])

  const totalPages = Math.max(1, Math.ceil(listFiltered.length / PAGE_SIZE))
  const offset = (page - 1) * PAGE_SIZE
  const visible = listFiltered.slice(offset, offset + PAGE_SIZE)

  function pick(o: LocalProcedureOption) {
    onChange(o.id)
    setOpen(false)
  }

  function pickFromList(o: LocalProcedureOption) {
    onChange(o.id)
    setListOpen(false)
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
              {selected ? formatProcedureLabel(selected) : placeholder}
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
                Nenhum procedimento encontrado.
              </CommandEmpty>
              {filtered.length > 0 ? (
                <CommandGroup heading="Procedimentos cadastrados">
                  {filtered.map((item) => {
                    const codeText =
                      typeof item.tussCode === 'string' && item.tussCode.trim().length > 0
                        ? item.tussCode
                        : item.isUnlisted
                          ? 'Não listado'
                          : '—'
                    return (
                      <CommandItem
                        key={item.id}
                        value={`${codeText} ${item.displayName ?? ''}`}
                        onSelect={() => pick(item)}
                        className="cursor-pointer items-start py-2 text-xs"
                      >
                        <Check
                          className={cn(
                            'mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary',
                            selected?.id === item.id ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="mr-2 mt-0.5 flex shrink-0 items-center gap-1.5">
                          {item.isCustomCoded ? (
                            <span className="rounded border border-[#DDD6FE] bg-[#EDE9FE] px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#5B21B6]">
                              Pers.
                            </span>
                          ) : item.isUnlisted ? (
                            <span className="rounded border border-[#E9D5FF] bg-[#FAF5FF] px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#6B21A8]">
                              Não list.
                            </span>
                          ) : null}
                          <span className="font-mono text-[11px] font-bold text-slate-900">
                            {codeText}
                          </span>
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="line-clamp-2 whitespace-normal break-words text-slate-700">
                            {item.displayName ?? codeText}
                          </span>
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setListSearch(search)
          setPage(1)
          setListOpen(true)
        }}
        className="h-9 gap-1.5"
        title="Ver lista paginada"
      >
        <ListFilter className="h-3.5 w-3.5" />
        <span className="text-xs">Ver em lista</span>
      </Button>

      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Procedimentos cadastrados</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              autoFocus
              placeholder="Buscar por código ou nome…"
              value={listSearch}
              onChange={(e) => {
                setListSearch(e.target.value)
                setPage(1)
              }}
              className="pl-9"
            />
          </div>
          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-slate-200">
            {visible.length === 0 ? (
              <p className="px-4 py-12 text-center text-xs text-slate-500">Nenhum resultado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">TUSS</TableHead>
                    <TableHead>Nome completo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((item) => (
                    <TableRow
                      key={item.id}
                      onClick={() => pickFromList(item)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-mono text-xs font-bold text-primary">
                        {typeof item.tussCode === 'string' && item.tussCode.trim().length > 0
                          ? item.tussCode
                          : item.isUnlisted
                            ? 'Não listado'
                            : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        <p className="line-clamp-2 whitespace-normal break-words">
                          {item.displayName ??
                            (typeof item.tussCode === 'string' && item.tussCode.trim().length > 0
                              ? item.tussCode
                              : '—')}
                        </p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <p>
              Página <span className="font-bold text-slate-800">{page}</span> de{' '}
              <span className="font-bold text-slate-800">{totalPages}</span> · {listFiltered.length}{' '}
              resultado{listFiltered.length === 1 ? '' : 's'}
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-8 gap-1"
              >
                <ChevronLeft className="h-3 w-3" />
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="h-8 gap-1"
              >
                Próxima
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
