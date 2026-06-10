'use client'

import { useEffect, useState, useTransition } from 'react'
import { ClipboardList, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Feature 032 — orientações ao paciente (autoria pela equipe).
 * Autossuficiente: busca/cria/remove via /api/pacientes/[id]/orientacoes.
 * Aparece no portal do paciente quando a seção "orientacoes" está habilitada.
 */

interface Note {
  id: string
  body: string
  createdAt: string
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

export function CareNotesEditor({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const base = `/api/pacientes/${patientId}/orientacoes`
  const [notes, setNotes] = useState<Note[]>([])
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(base)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { notes: Note[] }
        if (!cancelled) setNotes(data.notes)
      } catch {
        if (!cancelled) setError('Não foi possível carregar as orientações.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [base])

  function add() {
    const text = body.trim()
    if (!text) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: text }),
        })
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          throw new Error(b.error?.message ?? `HTTP ${res.status}`)
        }
        const { id } = (await res.json()) as { id: string }
        setNotes((prev) => [{ id, body: text, createdAt: new Date().toISOString() }, ...prev])
        setBody('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar.')
      }
    })
  }

  function remove(id: string) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`${base}?noteId=${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setNotes((prev) => prev.filter((n) => n.id !== id))
      } catch {
        setError('Erro ao remover.')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-primary" />
          Orientações ao paciente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">
          Texto exibido ao paciente no portal (quando a seção “Orientações” está habilitada nas
          configurações do portal).
        </p>

        {canWrite ? (
          <div className="space-y-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              rows={3}
              placeholder="Ex.: Manter caminhada 30 min, 5x/semana. Retornar em 30 dias com exames."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              {error ? <span className="text-xs text-destructive">{error}</span> : <span />}
              <Button size="sm" onClick={add} disabled={pending || body.trim().length === 0}>
                {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                Adicionar orientação
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-400">Carregando…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma orientação registrada.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <p className="whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{fmt(n.createdAt)}</span>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => remove(n.id)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" /> Remover
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
