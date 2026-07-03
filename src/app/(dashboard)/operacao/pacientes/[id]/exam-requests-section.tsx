'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FlaskConical, Loader2, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ExamItem {
  code: string | null
  description: string
}

interface ExamRequestRow {
  id: string
  items: ExamItem[]
  clinicalIndication: string | null
  notes: string | null
  issuedAt: string | null
  createdAt: string
}

interface TussResult {
  code: string
  description: string
}

/**
 * Backlog 1/4/1 — solicitação de exame estruturada: indicação clínica + lista de
 * exames (busca no catálogo TUSS tabela 22 ou texto livre) e download do PDF.
 * Self-contained (GET/POST imediatos).
 */
export function ExamRequestsSection({
  patientId,
  canWrite,
}: {
  patientId: string
  canWrite: boolean
}) {
  const [rows, setRows] = useState<ExamRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ExamItem[]>([])
  const [indication, setIndication] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Busca TUSS
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TussResult[]>([])
  const [searching, setSearching] = useState(false)
  const [freeText, setFreeText] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pacientes/${patientId}/solicitacoes-exame`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const body = (await res.json()) as { rows: ExamRequestRow[] }
        setRows(body.rows)
      }
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tuss-codes?table=22&limit=15&q=${encodeURIComponent(q)}`, {
          cache: 'no-store',
        })
        if (res.ok) {
          const data = (await res.json()) as TussResult[]
          setResults(data)
        }
      } catch {
        /* busca é best-effort */
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [query])

  function addItem(item: ExamItem) {
    setItems((prev) => (prev.some((p) => p.code && p.code === item.code) ? prev : [...prev, item]))
    setQuery('')
    setResults([])
  }

  function addFreeText() {
    const desc = freeText.trim()
    if (desc.length < 1) return
    setItems((prev) => [...prev, { code: null, description: desc }])
    setFreeText('')
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function reset() {
    setItems([])
    setIndication('')
    setNotes('')
    setQuery('')
    setResults([])
    setFreeText('')
    setError(null)
  }

  async function emit() {
    setError(null)
    if (items.length < 1) {
      setError('Adicione ao menos um exame.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/solicitacoes-exame`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items,
          clinical_indication: indication.trim() || null,
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao salvar.')
        return
      }
      reset()
      setOpen(false)
      await load()
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FlaskConical className="h-4 w-4 text-primary" />
          Solicitações de exame
        </CardTitle>
        {canWrite ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => setOpen((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" /> Nova
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {open && canWrite ? (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">
                Buscar exame (catálogo TUSS)
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Digite código ou nome do exame…"
                  className="pl-8"
                />
                {searching ? (
                  <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-slate-400" />
                ) : null}
                {results.length > 0 ? (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-md">
                    {results.map((r) => (
                      <li key={r.code}>
                        <button
                          type="button"
                          onClick={() => addItem({ code: r.code, description: r.description })}
                          className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                        >
                          <span className="font-mono font-bold text-slate-500">{r.code}</span>
                          <span className="flex-1 text-slate-700">{r.description}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-[11px] font-bold uppercase text-slate-500">
                  Ou exame em texto livre
                </Label>
                <Input
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addFreeText()
                    }
                  }}
                  placeholder="Ex.: Tomografia de coerência óptica"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9"
                onClick={addFreeText}
              >
                Adicionar
              </Button>
            </div>

            {items.length > 0 ? (
              <ul className="space-y-1">
                {items.map((it, idx) => (
                  <li
                    key={`${it.code ?? 'free'}-${idx}`}
                    className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  >
                    {it.code ? (
                      <span className="font-mono font-bold text-slate-500">{it.code}</span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold uppercase text-slate-400">
                        livre
                      </span>
                    )}
                    <span className="flex-1 text-slate-700">{it.description}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-slate-400 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-slate-400">Nenhum exame adicionado ainda.</p>
            )}

            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">
                Indicação clínica
              </Label>
              <Textarea
                value={indication}
                onChange={(e) => setIndication(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Ex.: Investigação de baixa acuidade visual progressiva em OD."
              />
            </div>

            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">
                Observações (opcional)
              </Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </div>

            {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
            <Button type="button" size="sm" onClick={emit} disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Gerar solicitação
            </Button>
          </div>
        ) : null}

        {loading ? (
          <p className="py-3 text-center text-xs text-slate-500">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-500">Nenhuma solicitação de exame.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <span className="flex-1 font-semibold text-slate-800">
                  {r.items.map((i) => i.description).join(', ')}
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                  {r.items.length} {r.items.length === 1 ? 'exame' : 'exames'}
                </span>
                {r.issuedAt ? (
                  <span className="text-[10px] font-semibold text-success-text">emitido</span>
                ) : null}
                <span className="whitespace-nowrap text-slate-400">{formatDate(r.createdAt)}</span>
                <a
                  href={`/api/pacientes/${patientId}/solicitacoes-exame/${r.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-link hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}
