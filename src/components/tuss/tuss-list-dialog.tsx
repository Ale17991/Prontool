'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TussTableBadge, type TussTable } from '@/app/(dashboard)/cadastros/procedimentos/tuss-table-badge'

export interface TussListItem {
  code: string
  description: string
  tussTable: TussTable
  manufacturer: string | null
}

export interface TussListDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: TussTable
  onSelect: (item: TussListItem) => void
  initialQuery?: string
}

const PAGE_SIZE = 20
const FETCH_LIMIT = 200

interface RawHit {
  code: string
  description: string
  manufacturer?: string | null
  tussTable?: TussTable
  tussTableLabel?: string | null
}

export function TussListDialog({
  open,
  onOpenChange,
  table,
  onSelect,
  initialQuery,
}: TussListDialogProps) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [items, setItems] = useState<TussListItem[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery(initialQuery ?? '')
      setPage(1)
    }
  }, [open, initialQuery])

  // Debounced fetch when query changes (or on open).
  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          q: query.trim(),
          table,
          limit: String(FETCH_LIMIT),
        })
        const res = await fetch(`/api/tuss-codes?${params.toString()}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) {
          setError(`HTTP ${res.status}`)
          setItems([])
          return
        }
        const data = (await res.json()) as RawHit[]
        setItems(
          data.map((d) => ({
            code: d.code,
            description: d.description,
            tussTable: d.tussTable ?? table,
            manufacturer: d.manufacturer ?? null,
          })),
        )
        setPage(1)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [open, query, table])

  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const offset = (page - 1) * PAGE_SIZE
  const visible = items.slice(offset, offset + PAGE_SIZE)
  const showsBuffer = total >= FETCH_LIMIT

  function handleSelect(item: TussListItem) {
    onSelect(item)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Catálogo TUSS — Tabela {table}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            autoFocus
            placeholder="Buscar por código ou nome…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {showsBuffer ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
            Mostrando os 200 primeiros resultados — refine a busca para ver mais.
          </p>
        ) : null}

        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-slate-200">
          {loading ? (
            <p className="px-4 py-12 text-center text-xs text-slate-500">Carregando…</p>
          ) : error ? (
            <p className="px-4 py-12 text-center text-xs text-rose-600">Erro: {error}</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-12 text-center text-xs text-slate-500">
              {query.trim().length === 0
                ? 'Digite para buscar no catálogo.'
                : 'Nenhum resultado.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">TUSS</TableHead>
                  <TableHead>Nome completo</TableHead>
                  <TableHead className="w-16 text-right">Tabela</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => (
                  <TableRow
                    key={item.code}
                    onClick={() => handleSelect(item)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-mono text-xs font-bold text-primary">
                      {item.code}
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <p className="line-clamp-2 whitespace-normal break-words">
                        {item.description}
                      </p>
                      {item.manufacturer ? (
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-slate-400">
                          {item.manufacturer}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <TussTableBadge table={item.tussTable} />
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
            <span className="font-bold text-slate-800">{totalPages}</span> · {total} resultado
            {total === 1 ? '' : 's'}
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
  )
}
