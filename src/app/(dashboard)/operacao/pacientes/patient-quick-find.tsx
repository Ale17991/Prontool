'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search, User, X } from 'lucide-react'
import { TagBadge } from '@/components/patient-tags/tag-badge'
import type { PatientTagColor } from '@/lib/core/patient-tags/palette'

/**
 * Busca instantanea de paciente na pagina /operacao/pacientes. Click no
 * resultado abre a ficha direto — substitui o form GET tradicional (que
 * exigia "digitar -> Buscar -> escolher linha -> Abrir"). Agora: digite
 * 1 letra, dropdown aparece, click no nome -> ficha.
 *
 * Reusa endpoint /api/pacientes (mesma rota que o typeahead usa em forms).
 * Pacientes anonimizados sao filtrados na resposta — apenas ativos
 * aparecem aqui.
 */
interface ApiTag {
  id: string
  name: string
  color: PatientTagColor
}

interface ApiItem {
  id: string
  fullName: string
  cpf: string
  anonymizedAt: string | null
  planName?: string | null
  tags?: ApiTag[]
}

interface Item {
  id: string
  fullName: string
  cpf: string
  planName: string | null
  tags: ApiTag[]
}

function maskCpf(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length !== 11) return raw
  return `***.***.***-${d.slice(9)}`
}

export function PatientQuickFind() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (search.trim().length < 1) {
      setItems([])
      setLoading(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          page_size: '8',
          include: 'plan',
          q: search.trim(),
        })
        const res = await fetch(`/api/pacientes?${params.toString()}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) {
          setError('Falha ao buscar.')
          setItems([])
          return
        }
        const body = (await res.json()) as { items: ApiItem[] }
        const mapped: Item[] = (body.items ?? [])
          .filter((p) => !p.anonymizedAt)
          .map((p) => ({
            id: p.id,
            fullName: p.fullName || '(sem nome)',
            cpf: p.cpf ?? '',
            planName: p.planName ?? null,
            tags: p.tags ?? [],
          }))
        setItems(mapped)
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return
        setError('Falha ao buscar.')
        setItems([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      ctrl.abort()
    }
  }, [search])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function navigateTo(id: string) {
    setOpen(false)
    setSearch('')
    router.push(`/operacao/pacientes/${id}`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      setSearch('')
      return
    }
    if (e.key === 'Enter' && items.length > 0 && items[0]) {
      e.preventDefault()
      navigateTo(items[0].id)
    }
  }

  const showDropdown = open && search.trim().length > 0

  return (
    <div ref={containerRef} className="relative w-full md:w-80">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        placeholder="Buscar paciente por nome ou CPF…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-md border border-slate-200 bg-white pl-10 pr-9 text-sm outline-none transition-all focus:border-primary/30 focus:ring-2 focus:ring-primary/10"
      />
      {search ? (
        <button
          type="button"
          onClick={() => {
            setSearch('')
            setItems([])
          }}
          aria-label="Limpar busca"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Buscando…
            </div>
          ) : error ? (
            <p className="py-6 text-center text-xs text-destructive">{error}</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              Nenhum paciente encontrado.
            </p>
          ) : (
            <ul role="listbox">
              {items.map((p, idx) => (
                <li key={p.id} role="option" aria-selected={idx === 0}>
                  <button
                    type="button"
                    onClick={() => navigateTo(p.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-primary">
                      <User className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {p.fullName}
                        </span>
                        {p.tags.map((t) => (
                          <TagBadge key={t.id} name={t.name} color={t.color} size="sm" />
                        ))}
                      </span>
                      <span className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="font-mono">{maskCpf(p.cpf)}</span>
                        <span aria-hidden>·</span>
                        <span className="truncate">
                          {p.planName ?? 'Particular'}
                        </span>
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1 text-[9px]">
              Enter
            </kbd>{' '}
            abre o primeiro resultado
          </div>
        </div>
      ) : null}
    </div>
  )
}
