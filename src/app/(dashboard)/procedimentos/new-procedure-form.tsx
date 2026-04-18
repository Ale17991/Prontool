'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronsUpDown } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface TussHit {
  code: string
  description: string
  terminologyChapter?: string | null
}

export function NewProcedureForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [results, setResults] = useState<TussHit[]>([])
  const [selected, setSelected] = useState<TussHit | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!searchValue.trim()) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/tuss-codes?q=${encodeURIComponent(searchValue.trim())}&limit=30`,
          { signal: ctrl.signal },
        )
        if (!res.ok) return
        const data = (await res.json()) as TussHit[]
        setResults(data)
      } catch {
        // ignore abort / network errors — user can retry
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [searchValue])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selected) {
      setError('Selecione um código TUSS.')
      return
    }
    setPending(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/procedimentos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tuss_code: selected.code,
          display_name: displayName.trim() || null,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      setSuccess(`Procedimento ${selected.code} cadastrado.`)
      setSelected(null)
      setSearchValue('')
      setDisplayName('')
      setResults([])
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Código TUSS</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between font-normal"
            >
              <span className="truncate">
                {selected ? `${selected.code} — ${selected.description}` : 'Buscar por código ou nome…'}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] p-0"
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Digite para buscar…"
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty className="py-6 text-center text-xs text-slate-500">
                  {searchValue.trim() ? 'Nenhum resultado.' : 'Digite ao menos 2 caracteres.'}
                </CommandEmpty>
                {results.length > 0 ? (
                  <CommandGroup heading="Catálogo TUSS">
                    {results.map((item) => (
                      <CommandItem
                        key={item.code}
                        value={`${item.code} ${item.description}`}
                        onSelect={() => {
                          setSelected(item)
                          setOpen(false)
                        }}
                        className="cursor-pointer py-2 text-xs"
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4 text-primary',
                            selected?.code === item.code ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="mr-2 font-bold text-slate-900">{item.code}</span>
                        <span className="truncate text-slate-500">{item.description}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {selected ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">
            Selecionado
          </p>
          <p className="font-mono text-xs font-bold text-primary">{selected.code}</p>
          <p className="text-xs text-slate-700">{selected.description}</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="display-name" className="text-xs">
          Nome de exibição <span className="text-slate-400">(opcional)</span>
        </Label>
        <Input
          id="display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Ex.: Consulta fisioterapia (30 min)"
          maxLength={120}
        />
      </div>

      <Button type="submit" disabled={pending || !selected} className="w-full">
        {pending ? 'Salvando…' : 'Cadastrar procedimento'}
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
